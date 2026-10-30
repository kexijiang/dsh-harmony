export class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) { return Response.json(value, init); }
}
