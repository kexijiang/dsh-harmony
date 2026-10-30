import { useEffect, useMemo, useRef, useState } from "react";
import type { HarmonySnapshot } from "@/lib/harmony/types";
import { copyText } from "@/lib/clipboard";
import { HarmonyRequestError } from "@/lib/harmony/request-error";
import { frameBounds, hitNodes, nodeAncestors } from "./inspector-model";
import styles from "./UiInspector.module.css";
type Snapshot = Omit<HarmonySnapshot, "screenshot"> & {
  screenshot?: { width: number; height: number; dataUrl: string };
};
export function UiInspector({
  serial,
  online,
  active,
  chinese,
}: {
  serial: string;
  online: boolean;
  active: boolean;
  chinese: boolean;
}) {
  const t = (zh: string, en: string) => (chinese ? zh : en);
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState(""),
    [hover, setHover] = useState(""),
    [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(new Set<string>()),
    [hits, setHits] = useState<string[]>([]),
    [allBounds, setAllBounds] = useState(false);
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null),
    treeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSnapshot(undefined);
    setSelected("");
    setHover("");
    setHits([]);
    setQuery("");
    setError("");
    setNotice("");
    return () => controller.current?.abort();
  }, [serial]);
  useEffect(() => {
    if (!active) {
      controller.current?.abort();
      setBusy(false);
    }
  }, [active]);
  const nodes = snapshot?.nodes ?? [],
    byRef = useMemo(() => new Map(nodes.map((n) => [n.ref, n])), [nodes]);
  const parents = useMemo(
    () => new Set(nodes.map((n) => n.parentRef).filter(Boolean)),
    [nodes],
  );
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase(),
      matches = new Set<string>();
    if (q)
      for (const n of nodes)
        if (
          [n.type, n.text, n.id, n.description, n.ref].some((v) =>
            v?.toLowerCase().includes(q),
          )
        ) {
          matches.add(n.ref);
          for (const p of nodeAncestors(n, byRef)) matches.add(p.ref);
        }
    return nodes.filter((n) =>
      q
        ? matches.has(n.ref)
        : !nodeAncestors(n, byRef).some((p) => collapsed.has(p.ref)),
    );
  }, [nodes, byRef, query, collapsed]);
  const node = byRef.get(selected),
    marked = byRef.get(hover) || node,
    box = marked && frameBounds(marked, snapshot?.geometry);
  const capture = async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(
        `/api/harmony/tree?${new URLSearchParams({ serial, includeScreenshot: "1" })}`,
        { signal: request.signal, cache: "no-store" },
      );
      const data = await r.json();
      if (!r.ok)
        throw new HarmonyRequestError(data.error, r.status);
      if (request.signal.aborted) return;
      setSnapshot(data.snapshot);
      setSelected("");
      setHover("");
      setHits([]);
      setCollapsed(new Set());
      setQuery("");
    } catch (e) {
      if (!request.signal.aborted) setError((e instanceof HarmonyRequestError ? e.messageFor(chinese) : e instanceof Error ? e.message : String(e)));
    } finally {
      if (controller.current === request) setBusy(false);
    }
  };
  const select = (ref: string) => {
    setSelected(ref);
    setHover("");
    const n = byRef.get(ref);
    if (n)
      setCollapsed(
        (current) =>
          new Set(
            [...current].filter(
              (r) => !nodeAncestors(n, byRef).some((p) => p.ref === r),
            ),
          ),
      );
    setQuery("");
    setTimeout(() => {
      for (const el of treeRef.current?.querySelectorAll<HTMLElement>(
        "[data-node-ref]",
      ) ?? [])
        if (el.dataset.nodeRef === ref) el.scrollIntoView({ block: "nearest" });
    }, 0);
  };
  const pointHits = (
    event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect(),
      s = snapshot?.screenshot;
    if (!s) return [];
    return hitNodes(
      nodes,
      snapshot?.geometry,
      ((event.clientX - rect.left) * s.width) / rect.width,
      ((event.clientY - rect.top) * s.height) / rect.height,
    );
  };
  const clipboard = async (value: string) => {
    try {
      await copyText(value);
      setNotice(t("已复制", "Copied"));
    } catch {
      setNotice(
        t("复制失败，请手动选择文本", "Copy failed; select text manually"),
      );
    }
  };
  return (
    <section
      className={styles.root}
      aria-label={t("UI 检查器", "UI inspector")}
    >
      <header className={styles.toolbar}>
        <div>
          <strong>{t("UI 检查器", "UI inspector")}</strong>
          <small>
            {t(
              "点击快照查看组件，不操作手机",
              "Select snapshot components without controlling the phone",
            )}
          </small>
        </div>
        <button disabled={!online || busy} onClick={() => void capture()}>
          {busy
            ? t("正在获取…", "Capturing…")
            : snapshot
              ? t("刷新快照", "Refresh snapshot")
              : t("获取当前界面", "Capture current screen")}
        </button>
        {busy ? (
          <button
            onClick={() => {
              controller.current?.abort();
              setBusy(false);
            }}
          >
            {t("取消", "Cancel")}
          </button>
        ) : null}
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {!snapshot ? (
        <div className={styles.empty}>
          {t(
            "获取一次页面快照，即可在画面和组件树中选择元素并查看属性。",
            "Capture a page to inspect its components and properties.",
          )}
        </div>
      ) : (
        <>
          <div className={styles.meta}>
            {nodes.length} {t("个节点", "nodes")} ·{" "}
            {new Date(snapshot.capturedAt).toLocaleTimeString()} ·{" "}
            {t(
              "静态快照，页面变化后请刷新",
              "Static snapshot; refresh after page changes",
            )}
          </div>
          {snapshot.quality?.treeStatus !== "valid" ||
          !snapshot.quality?.scopeComplete ? (
            <p role="status">
              {t(
                "设备返回的结构不完整，部分组件可能不可见。",
                "The device returned an incomplete tree; some components may be missing.",
              )}
            </p>
          ) : null}
          <div className={styles.layout}>
            <div className={styles.preview}>
              <label>
                <input
                  type="checkbox"
                  checked={allBounds}
                  onChange={(e) => setAllBounds(e.target.checked)}
                />
                {t("显示组件边界", "Show component bounds")}
              </label>
              {snapshot.screenshot ? (
                <div
                  className={styles.canvas}
                  style={{
                    maxWidth: Math.min(
                      300,
                      (620 * snapshot.screenshot.width) /
                        snapshot.screenshot.height,
                    ),
                    aspectRatio: `${snapshot.screenshot.width}/${snapshot.screenshot.height}`,
                  }}
                >
                  <img
                    src={snapshot.screenshot.dataUrl}
                    alt={t("当前界面快照", "Current screen snapshot")}
                    draggable={false}
                  />
                  <svg
                    viewBox={`0 0 ${snapshot.screenshot.width} ${snapshot.screenshot.height}`}
                    aria-label={t(
                      "在快照中选择组件",
                      "Select a component in the snapshot",
                    )}
                    onPointerMove={(e) => setHover(pointHits(e)[0]?.ref ?? "")}
                    onPointerLeave={() => setHover("")}
                    onClick={(e) => {
                      const found = pointHits(e);
                      setHits(found.map((n) => n.ref));
                      if (found[0]) select(found[0].ref);
                      else {
                        setSelected("");
                        setNotice(
                          t(
                            "此位置没有可识别的组件",
                            "No exposed component at this position",
                          ),
                        );
                      }
                    }}
                  >
                    {allBounds
                      ? nodes
                          .filter((n) => n.visible !== false)
                          .map((n) => {
                            const b = frameBounds(n, snapshot.geometry);
                            return b ? (
                              <rect
                                key={n.ref}
                                x={b.left}
                                y={b.top}
                                width={b.right - b.left}
                                height={b.bottom - b.top}
                                className={styles.outline}
                              />
                            ) : null;
                          })
                      : null}
                    {box ? (
                      <rect
                        x={box.left}
                        y={box.top}
                        width={box.right - box.left}
                        height={box.bottom - box.top}
                        className={styles.highlight}
                      />
                    ) : null}
                  </svg>
                </div>
              ) : (
                <p>
                  {t(
                    "截图不可用，可继续浏览组件树。",
                    "Screenshot unavailable; the tree is still accessible.",
                  )}
                </p>
              )}
              {!snapshot.geometry ? (
                <small>
                  {t(
                    "未能校验屏幕坐标，画面选取暂不可用；可从组件树选择。",
                    "Display coordinates could not be verified; select from the tree.",
                  )}
                </small>
              ) : null}
              {hits.length > 1 ? (
                <label>
                  {t("重叠组件", "Overlapping components")}
                  <select
                    aria-label={t("重叠组件", "Overlapping components")}
                    value={hits.includes(selected) ? selected : hits[0]}
                    onChange={(e) => select(e.target.value)}
                  >
                    {hits.map((ref) => (
                      <option key={ref} value={ref}>
                        {byRef.get(ref)?.type || "Node"} ·{" "}
                        {byRef.get(ref)?.text || ref}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className={styles.structure}>
              <input
                aria-label={t("搜索组件", "Search components")}
                placeholder={t(
                  "搜索文字、类型或 ID",
                  "Search text, type or ID",
                )}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div
                className={styles.tree}
                ref={treeRef}
                role="tree"
                aria-label={t("组件树", "Component tree")}
              >
                {visible.map((n) => {
                  const depth = nodeAncestors(n, byRef).length;
                  return (
                    <div
                      key={n.ref}
                      role="treeitem"
                      aria-level={depth + 1}
                      aria-selected={selected === n.ref}
                      aria-expanded={
                        parents.has(n.ref) ? !collapsed.has(n.ref) : undefined
                      }
                      data-node-ref={n.ref}
                      className={styles.node}
                      style={{ paddingLeft: Math.min(depth, 20) * 12 + 4 }}
                    >
                      {parents.has(n.ref) ? (
                        <button
                          aria-label={`${t("展开或折叠", "Expand or collapse")} ${n.ref}`}
                          onClick={() =>
                            setCollapsed((current) => {
                              const next = new Set(current);
                              next.has(n.ref)
                                ? next.delete(n.ref)
                                : next.add(n.ref);
                              return next;
                            })
                          }
                        >
                          {collapsed.has(n.ref) ? "▸" : "▾"}
                        </button>
                      ) : (
                        <span className={styles.spacer} />
                      )}
                      <button
                        title={[n.type, n.text, n.id, n.ref]
                          .filter(Boolean)
                          .join(" · ")}
                        onClick={() => select(n.ref)}
                        onPointerEnter={() => setHover(n.ref)}
                        onPointerLeave={() => setHover("")}
                      >
                        {n.type || "Node"}{" "}
                        {n.text ? `“${n.text}”` : n.id ? `#${n.id}` : ""}
                      </button>
                    </div>
                  );
                })}
                {!visible.length ? (
                  <p>{t("没有匹配的组件", "No matching components")}</p>
                ) : null}
              </div>
              <section
                className={styles.properties}
                aria-label={t("组件属性", "Component properties")}
              >
                <strong>{t("组件属性", "Component properties")}</strong>
                {node ? (
                  <>
                    <div className={styles.actions}>
                      <button
                        onClick={() =>
                          void clipboard(JSON.stringify(node, null, 2))
                        }
                      >
                        {t("复制节点 JSON", "Copy node JSON")}
                      </button>
                      <button onClick={() => void clipboard(node.ref)}>
                        {t("复制引用", "Copy reference")}
                      </button>
                      {node.parentRef && byRef.has(node.parentRef) ? (
                        <button onClick={() => select(node.parentRef!)}>
                          {t("选择父组件", "Select parent")}
                        </button>
                      ) : null}
                    </div>
                    <dl>
                      {Object.entries(node)
                        .filter(([, v]) => v !== undefined)
                        .map(([k, v]) => (
                          <div key={k}>
                            <dt>{k}</dt>
                            <dd>
                              {typeof v === "object"
                                ? JSON.stringify(v)
                                : String(v)}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  </>
                ) : (
                  <p>
                    {t(
                      "点击画面或组件树中的元素",
                      "Select an element in the snapshot or tree",
                    )}
                  </p>
                )}
                {notice ? <small role="status">{notice}</small> : null}
              </section>
            </div>
          </div>
          <small className={styles.footnote}>
            {t(
              "截图与结构按顺序采集；动画或页面切换可能造成差异。自绘内容取决于系统暴露的组件信息。",
              "Image and tree are captured sequentially; animations can cause differences. Custom content depends on exposed system nodes.",
            )}
          </small>
        </>
      )}
    </section>
  );
}
