export const defineTool = <T>(tool: T): T => tool;
// Piora's separate vision-model picker is replaced by the dsh agent's image input.
export class ModelRuntime {
  static async create() { return new ModelRuntime(); }
  getModels() { return []; }
  getError() { return undefined; }
  hasConfiguredAuth() { return false; }
  async complete() { throw new Error('Use harmony_control take_screenshot with a vision-capable dsh model.'); }
}
