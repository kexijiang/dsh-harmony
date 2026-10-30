import { Type } from '@sinclair/typebox';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
export { Type };
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validators = new WeakMap<object, ReturnType<typeof ajv.compile>>();
export function validateToolArguments(tool: any, call: any) {
  let validate = validators.get(tool);
  if (!validate) { validate = ajv.compile(tool.parameters); validators.set(tool, validate); }
  if (!validate(call.arguments)) throw new Error(ajv.errorsText(validate.errors));
  return call.arguments;
}
