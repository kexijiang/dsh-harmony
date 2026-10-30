import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HarmonyDeviceFile,
  HarmonyFileScope,
} from "@/lib/harmony/device-files";
import { copyText } from "@/lib/clipboard";
import { HarmonyRequestError } from "@/lib/harmony/request-error";
import { showPioraMessage } from "@/components/PioraMessage";
import { AliIcon } from "@/components/AliIcon";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import styles from "./DeviceExplorer.module.css";
type Props = {
  serial: string;
  chinese: boolean;
  canControl: boolean;
  ensureControl: () => Promise<string>;
  cwd?: string | null;
  onControlHandoff?: () => void;
  onDatabaseOpen?: (id: string) => void;
  initialSandbox?: { id: number; bundleName: string };
};
type Page = {
  files: HarmonyDeviceFile[];
  offset: number;
  more: boolean;
  loading?: boolean;
  error?: string;
};
const label = (f: HarmonyDeviceFile) =>
  f.kind === "directory" ? "folder" : "file";
function permissions(mode?: string) {
  if (!mode || !/^\d{3,4}$/.test(mode)) return mode || "—";
  return mode
    .slice(-3)
    .split("")
    .map((n) => {
      const v = Number(n);
      return `${v & 4 ? "r" : "-"}${v & 2 ? "w" : "-"}${v & 1 ? "x" : "-"}`;
    })
    .join("");
}
export function DeviceExplorer(props: Props) {
  const t = (zh: string, en: string) => (props.chinese ? zh : en);
  const [kind, setKind] = useState<HarmonyFileScope["kind"]>(
    props.initialSandbox ? "sandbox" : "shared",
  );
  const [bundle, setBundle] = useState(props.initialSandbox?.bundleName || ""),
    [draftBundle, setDraftBundle] = useState(bundle);
  useEffect(() => {
    if (props.initialSandbox) {
      setKind("sandbox");
      setBundle(props.initialSandbox.bundleName);
      setDraftBundle(props.initialSandbox.bundleName);
    }
  }, [props.initialSandbox]);
  return (
    <section
      className={styles.root}
      aria-label={t("设备文件浏览器", "Device file browser")}
    >
      <div className={styles.scope}>
        <strong>{t("设备文件浏览器", "Device file browser")}</strong>
        <select
          aria-label={t("文件视图", "File view")}
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="shared">{t("普通文件", "Device files")}</option>
          <option value="sandbox">{t("应用沙箱", "App sandbox")}</option>
        </select>
      </div>
      {kind === "sandbox" ? (
        <form
          className={styles.pathbar}
          onSubmit={(e) => {
            e.preventDefault();
            setBundle(draftBundle.trim());
          }}
        >
          <input
            aria-label={t("调试应用包名", "Debug app bundle")}
            placeholder={t(
              "输入可调试应用的包名",
              "Enter a debuggable app bundle",
            )}
            value={draftBundle}
            onChange={(e) => setDraftBundle(e.target.value)}
          />
          <button>{t("打开沙箱", "Open sandbox")}</button>
        </form>
      ) : null}
      {kind === "shared" || bundle ? (
        <DeviceTreeBrowser
          key={`${props.serial}:${kind}:${bundle}`}
          {...props}
          scope={kind === "shared" ? { kind } : { kind, bundleName: bundle }}
        />
      ) : (
        <p className={styles.hint}>
          {t(
            "填写包名后查看应用沙箱，访问范围由设备授权决定。",
            "Enter a bundle name to browse its device-authorized sandbox.",
          )}
        </p>
      )}
    </section>
  );
}
function DeviceTreeBrowser({
  serial,
  chinese,
  canControl,
  ensureControl,
  cwd,
  scope,
}: Props & { scope: HarmonyFileScope }) {
  const t = (zh: string, en: string) => (chinese ? zh : en);
  const initial = scope.kind === "shared" ? "/" : "data/storage/el2/base";
  const [root, setRoot] = useState(initial),
    [path, setPath] = useState(initial),
    [pages, setPages] = useState<Record<string, Page>>({});
  const [expanded, setExpanded] = useState(new Set<string>()),
    [selected, setSelected] = useState<HarmonyDeviceFile>();
  const [hidden, setHidden] = useState(false),
    [filter, setFilter] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [action, setAction] = useState(""),
    [value, setValue] = useState(""),
    [source, setSource] = useState("");
  const [preview, setPreview] = useState(""),
    [previewError, setPreviewError] = useState(""),
    [previewBusy, setPreviewBusy] = useState(false);
  const requests = useRef(new Map<string, AbortController>()),
    operation = useRef<AbortController | null>(null);
  const [menu, setMenu] = useState<{
      x: number;
      y: number;
      file: HarmonyDeviceFile;
    }>(),
    menuRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  useFocusTrap(sheetRef, !!action, {
    onEscape: () => {
      if (!busy) {
        operation.current?.abort();
        setAction("");
      }
    },
  });
  const params = (target: string) =>
    new URLSearchParams({
      serial,
      kind: scope.kind,
      path: target,
      ...(scope.kind === "sandbox" ? { bundleName: scope.bundleName } : {}),
    });
  const load = useCallback(
    async (target: string, offset = 0) => {
      requests.current.get(target)?.abort();
      const request = new AbortController();
      requests.current.set(target, request);
      setPages((all) => ({
        ...all,
        [target]: {
          files: offset ? (all[target]?.files ?? []) : [],
          offset,
          more: false,
          loading: true,
        },
      }));
      try {
        const query = params(target);
        query.set("offset", String(offset));
        const r = await fetch(`/api/harmony/files?${query}`, {
            signal: request.signal,
            cache: "no-store",
          }),
          data = await r.json();
        if (!r.ok)
          throw new HarmonyRequestError(data.error, r.status);
        if (request.signal.aborted) return;
        setPages((all) => ({
          ...all,
          [target]: {
            files: [
              ...(offset ? (all[target]?.files ?? []) : []),
              ...(data.files ?? []),
            ],
            offset,
            more: !!data.truncated,
          },
        }));
      } catch (e) {
        if (!request.signal.aborted)
          setPages((all) => ({
            ...all,
            [target]: {
              files: all[target]?.files ?? [],
              offset,
              more: false,
              error: (e instanceof HarmonyRequestError ? e.messageFor(chinese) : e instanceof Error ? e.message : String(e)),
            },
          }));
      } finally {
        if (requests.current.get(target) === request)
          requests.current.delete(target);
      }
    },
    [serial, scope.kind, scope.kind === "sandbox" ? scope.bundleName : ""],
  );
  useEffect(() => {
    setPages({});
    setExpanded(new Set([root]));
    setSelected(undefined);
    setMenu(undefined);
    setNotice("");
    void load(root);
    return () => {
      for (const r of requests.current.values()) r.abort();
      requests.current.clear();
      operation.current?.abort();
    };
  }, [root, load]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(undefined);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(undefined);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  const toggle = (file: HarmonyDeviceFile) => {
    if (file.kind !== "directory") return;
    setExpanded((current) => {
      const next = new Set(current);
      next.has(file.path) ? next.delete(file.path) : next.add(file.path);
      return next;
    });
    if (!pages[file.path]) void load(file.path);
  };
  const refresh = () => {
    void load(root);
    for (const p of expanded) if (p !== root) void load(p);
  };
  const begin = (next: string, file = selected) => {
    operation.current?.abort();
    setPreviewBusy(false);
    const folder =
      file?.kind === "directory"
        ? file.path
        : file
          ? file.path.slice(0, file.path.lastIndexOf("/")) || "/"
          : root;
    setSelected(file);
    setMenu(undefined);
    setAction(next);
    setValue(
      next === "download"
        ? cwd
          ? `${cwd.replace(/[\\/]$/, "")}/${file?.name || "download"}`
          : ""
        : next === "upload_file" || next === "create_directory"
          ? `${folder}${folder.endsWith("/") ? "" : "/"}${next === "create_directory" ? "new-folder" : ""}`
          : file?.path || "",
    );
    setSource("");
    setNotice("");
    setPreview("");
    setPreviewError("");
  };
  const readPreview = async (file: HarmonyDeviceFile) => {
    begin("preview", file);
    operation.current?.abort();
    const request = new AbortController();
    operation.current = request;
    setPreviewBusy(true);
    try {
      const r = await fetch(`/api/harmony/files/text?${params(file.path)}`, {
          signal: request.signal,
          cache: "no-store",
        }),
        data = await r.json();
      if (!r.ok)
        throw new HarmonyRequestError(data.error, r.status);
      if (!request.signal.aborted) setPreview(data.result?.text ?? "");
    } catch (e) {
      if (!request.signal.aborted) setPreviewError((e instanceof HarmonyRequestError ? e.messageFor(chinese) : e instanceof Error ? e.message : String(e)));
    } finally {
      if (operation.current === request) setPreviewBusy(false);
    }
  };
  const run = async () => {
    if (busy) return;
    if (action === "delete_path") {
      const answer = await showPioraMessage({
        title: t("删除设备文件？", "Delete device path?"),
        message: selected?.path || "",
        tone: "confirm",
        actions: [
          { id: "cancel", label: t("取消", "Cancel") },
          { id: "delete", label: t("删除", "Delete"), primary: true },
        ],
      });
      if (answer !== "delete") return;
    }
    const request = new AbortController();
    operation.current = request;
    setBusy(true);
    setNotice("");
    try {
      const shared = {
        serial,
        kind: scope.kind,
        ...(scope.kind === "sandbox" ? { bundleName: scope.bundleName } : {}),
      };
      const body =
        action === "download"
          ? {
              ...shared,
              action: "download",
              path: selected?.path,
              destinationPath: value,
            }
          : {
              ...shared,
              action,
              leaseToken: await ensureControl(),
              ...(action === "upload_file"
                ? { sourcePath: source, path: value, overwrite: false }
                : action === "create_directory"
                  ? { path: value }
                  : {
                      path: selected?.path,
                      ...(action === "rename_path" ||
                      action === "copy_path" ||
                      action === "move_path"
                        ? { newPath: value }
                        : {}),
                    }),
            };
      if (request.signal.aborted) return;
      const r = await fetch(
          action === "download" ? "/api/harmony/files" : "/api/harmony/action",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: request.signal,
          },
        ),
        data = await r.json();
      if (!r.ok)
        throw new HarmonyRequestError(data.error, r.status);
      if (
        (action === "copy_path" || action === "move_path") &&
        data.result?.receipt?.verification !== "passed"
      )
        throw new Error(
          t(
            "操作未通过完整性校验，请刷新目录核对结果。",
            "Integrity verification did not pass; refresh and check the result.",
          ),
        );
      if (request.signal.aborted) return;
      setNotice(t("操作完成", "Operation completed"));
      if (["delete_path", "rename_path", "move_path"].includes(action)) setSelected(undefined);
      setAction("");
      refresh();
    } catch (e) {
      if (!request.signal.aborted) setNotice((e instanceof HarmonyRequestError ? e.messageFor(chinese) : e instanceof Error ? e.message : String(e)));
    } finally {
      if (operation.current === request) setBusy(false);
    }
  };
  const showMenu = (e: React.MouseEvent, file: HarmonyDeviceFile) => {
    e.preventDefault();
    setSelected(file);
    setMenu({
      file,
      x: Math.max(0, Math.min(e.clientX, innerWidth - 200)),
      y: Math.max(0, Math.min(e.clientY, innerHeight - 285)),
    });
  };
  const rows = (directory: string, depth = 0): React.ReactNode => {
    const page = pages[directory];
    if (depth > 40) return null;
    const files = [...(page?.files ?? [])]
      .filter(
        (f) =>
          (hidden || !f.name.startsWith(".")) &&
          (!filter ||
            f.name.toLowerCase().includes(filter.toLowerCase()) ||
            f.kind === "directory"),
      )
      .sort(
        (a, b) =>
          Number(b.kind === "directory") - Number(a.kind === "directory") ||
          a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
    return (
      <>
        {files.map((file) => (
          <div key={file.path}>
            <div
              className={styles.row}
              role="row"
              aria-level={depth + 1}
              aria-expanded={
                file.kind === "directory" ? expanded.has(file.path) : undefined
              }
              aria-selected={selected?.path === file.path}
              tabIndex={0}
              onClick={() => setSelected(file)}
              onDoubleClick={() =>
                file.kind === "directory"
                  ? toggle(file)
                  : file.kind === "file"
                    ? void readPreview(file)
                    : begin("info", file)
              }
              onContextMenu={(e) => showMenu(e, file)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  file.kind === "directory"
                    ? toggle(file)
                    : begin("info", file);
                } else if (
                  e.key === "ArrowRight" &&
                  file.kind === "directory" &&
                  !expanded.has(file.path)
                ) {
                  e.preventDefault();
                  toggle(file);
                } else if (e.key === "ArrowLeft" && expanded.has(file.path)) {
                  e.preventDefault();
                  toggle(file);
                } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const all = [
                    ...e.currentTarget
                      .closest('[role="treegrid"]')!
                      .querySelectorAll<HTMLElement>('[role="row"][tabindex]'),
                  ];
                  all[
                    all.indexOf(e.currentTarget) +
                      (e.key === "ArrowDown" ? 1 : -1)
                  ]?.focus();
                }
              }}
            >
              <div
                role="gridcell"
                className={styles.name}
                style={{ paddingLeft: Math.min(depth, 20) * 16 + 4 }}
                title={file.path}
              >
                {file.kind === "directory" ? (
                  <button
                    aria-label={`${t("展开或折叠", "Expand or collapse")} ${file.path}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(file);
                    }}
                  >
                    {expanded.has(file.path) ? "▾" : "▸"}
                  </button>
                ) : (
                  <span className={styles.spacer} />
                )}
                <AliIcon name={label(file)} size={14} />
                <span>{file.name}</span>
              </div>
              <span role="gridcell" title={file.mode}>
                {permissions(file.mode)}
              </span>
              <span role="gridcell">
                {file.modifiedAt === undefined
                  ? "—"
                  : new Date(file.modifiedAt).toLocaleString(
                      chinese ? "zh-CN" : "en-GB",
                      {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      },
                    )}
              </span>
              <span role="gridcell">
                {file.size === undefined
                  ? "—"
                  : `${file.size.toLocaleString()} B`}
              </span>
            </div>
            {expanded.has(file.path) && file.kind === "directory"
              ? rows(file.path, depth + 1)
              : null}
          </div>
        ))}
        {page?.loading ? (
          <div
            className={styles.status}
            role="status"
            style={{ paddingLeft: depth * 16 + 12 }}
          >
            {t("正在读取…", "Loading…")}
          </div>
        ) : null}
        {page?.error ? (
          <div
            className={styles.status}
            role="alert"
            style={{ paddingLeft: depth * 16 + 12 }}
          >
            {page.error}
            <button onClick={() => void load(directory)}>
              {t("重试", "Retry")}
            </button>
          </div>
        ) : null}
        {page && !page.loading && !page.error && !files.length ? (
          <div
            className={styles.status}
            style={{ paddingLeft: depth * 16 + 12 }}
          >
            {t("没有可显示的项目", "No visible items")}
          </div>
        ) : null}
        {page?.more ? (
          <button
            className={styles.loadMore}
            disabled={page.loading || page.offset >= 50000}
            onClick={() => void load(directory, page.offset + 500)}
          >
            {t("加载更多", "Load more")}
          </button>
        ) : null}
      </>
    );
  };
  const actions = [
    ["info", t("属性", "Properties")],
    ...(selected?.kind === "file"
      ? [
          ["preview", t("预览", "Preview")],
          ["download", t("下载到本机…", "Download…")],
        ]
      : []),
    ["upload_file", t("上传文件…", "Upload…")],
    ["create_directory", t("新建文件夹…", "New folder…")],
    ["rename_path", t("重命名…", "Rename…")],
    ["copy_path", t("复制到…", "Copy to…")],
    ["move_path", t("移动到…", "Move to…")],
    ["delete_path", t("删除…", "Delete…")],
  ];
  return (
    <>
      <div className={styles.toolbar}>
        <button title={t("刷新目录", "Refresh folders")} onClick={refresh}>
          ↻
        </button>
        <button
          title={t("全部折叠", "Collapse all")}
          onClick={() => setExpanded(new Set([root]))}
        >
          ⊟
        </button>
        <button onClick={() => begin("upload_file")}>
          {t("上传", "Upload")}
        </button>
        <button onClick={() => begin("create_directory")}>
          {t("新建", "New")}
        </button>
        <button disabled={!selected} onClick={() => begin("info")}>
          {t("属性 / 操作", "Properties / actions")}
        </button>
        <input
          aria-label={t("筛选已加载的文件", "Filter loaded files")}
          placeholder={t("筛选已加载的文件", "Filter loaded files")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={hidden}
            onChange={(e) => setHidden(e.target.checked)}
          />
          {t("隐藏文件", "Hidden")}
        </label>
      </div>
      <form
        className={styles.pathbar}
        onSubmit={(e) => {
          e.preventDefault();
          if (path.trim()) setRoot(path.trim());
        }}
      >
        <input
          aria-label={t("设备目录路径", "Device directory path")}
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button>{t("前往", "Go")}</button>
        <button
          type="button"
          onClick={() => {
            setPath(initial);
            setRoot(initial);
          }}
        >
          {t("根目录", "Root")}
        </button>
      </form>
      <div
        className={styles.tree}
        role="treegrid"
        aria-label={t("设备文件目录", "Device file tree")}
      >
        <div className={styles.head} role="row">
          {[
            t("名称", "Name"),
            t("权限", "Permissions"),
            t("修改日期", "Modified"),
            t("大小", "Size"),
          ].map((s) => (
            <span role="columnheader" key={s}>
              {s}
            </span>
          ))}
        </div>
        {rows(root)}
      </div>
      <footer className={styles.footer}>
        <span title={selected?.path || root}>{selected?.path || root}</span>
        {notice ? <span role="status">{notice}</span> : null}
      </footer>
      {menu ? (
        <div
          className={styles.menu}
          role="menu"
          ref={menuRef}
          style={{
            left: menu.x,
            top: menu.y,
            maxHeight: innerHeight - menu.y - 8,
          }}
        >
          {actions.map(([id, text]) => (
            <button
              role="menuitem"
              key={id}
              onClick={() =>
                id === "preview"
                  ? void readPreview(menu.file)
                  : begin(id, menu.file)
              }
            >
              {text}
            </button>
          ))}
          <button
            role="menuitem"
            onClick={() => {
              void copyText(menu.file.path)
                .then(() => setNotice(t("路径已复制", "Path copied")))
                .catch(() => setNotice(t("复制失败", "Copy failed")));
              setMenu(undefined);
            }}
          >
            {t("复制路径", "Copy path")}
          </button>
        </div>
      ) : null}
      {action ? (
        <div
          className={styles.backdrop}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && !busy) {
              operation.current?.abort();
              setAction("");
            }
          }}
        >
          <section
            ref={sheetRef}
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label={t("文件属性与操作", "File properties and actions")}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) {
                operation.current?.abort();
                setAction("");
              }
            }}
          >
            <header>
              <strong>{selected?.name || t("文件操作", "File actions")}</strong>
              <button
                aria-label={t("关闭文件操作", "Close file actions")}
                disabled={busy}
                onClick={() => {
                  operation.current?.abort();
                  setAction("");
                }}
              >
                ×
              </button>
            </header>
            {selected ? (
              <>
                <p className={styles.selectedPath}>{selected.path}</p>
                <dl>
                  {[
                    [t("类型", "Type"), selected.kind],
                    [t("权限", "Permissions"), permissions(selected.mode)],
                    [
                      t("大小", "Size"),
                      selected.size === undefined ? "—" : `${selected.size} B`,
                    ],
                    [
                      t("修改时间", "Modified"),
                      selected.modifiedAt === undefined
                        ? "—"
                        : new Date(selected.modifiedAt).toLocaleString(),
                    ],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className={styles.buttons}>
                  {actions
                    .filter(([id]) => id !== "info")
                    .map(([id, text]) => (
                      <button
                        key={id}
                        disabled={busy}
                        onClick={() =>
                          id === "preview"
                            ? void readPreview(selected)
                            : begin(id)
                        }
                      >
                        {text}
                      </button>
                    ))}
                </div>
              </>
            ) : null}
            {action === "preview" ? (
              <>
                <h3>{t("文本预览（只读）", "Text preview (read only)")}</h3>
                {previewBusy ? (
                  <p>{t("读取中…", "Loading…")}</p>
                ) : previewError ? (
                  <p role="alert">{previewError}</p>
                ) : (
                  <pre>{preview || t("空文件", "Empty file")}</pre>
                )}
              </>
            ) : action !== "info" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run();
                }}
              >
                <h3>{actions.find(([id]) => id === action)?.[1]}</h3>
                {action === "upload_file" ? (
                  <label>
                    {t("本机文件完整路径", "Local source path")}
                    <input
                      required
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    />
                  </label>
                ) : null}
                {action !== "delete_path" ? (
                  <label>
                    {action === "download"
                      ? t("保存到本机路径", "Local destination path")
                      : t("设备目标完整路径", "Device destination path")}
                    <input
                      required
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </label>
                ) : (
                  <p>
                    {t(
                      "将删除选中的设备路径。",
                      "The selected device path will be deleted.",
                    )}
                  </p>
                )}
                <button
                  disabled={busy || (action !== "download" && !canControl)}
                >
                  {busy ? t("处理中…", "Working…") : t("执行", "Run")}
                </button>
                {busy ? (
                  <button
                    type="button"
                    onClick={() => operation.current?.abort()}
                  >
                    {t("取消", "Cancel")}
                  </button>
                ) : null}
              </form>
            ) : null}
            {notice ? <p role="status">{notice}</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
