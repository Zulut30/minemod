export type BuiltinPackErrorCode =
  | "BUILTIN_PACK_NOT_FOUND"
  | "BUILTIN_PACK_INTEGRITY_FAILED"
  | "BUILTIN_PACK_FILE_NOT_FOUND";

export class BuiltinPackIntegrityError extends Error {
  readonly code: BuiltinPackErrorCode;

  constructor(code: BuiltinPackErrorCode, message: string) {
    super(message);
    this.name = "BuiltinPackIntegrityError";
    this.code = code;
  }
}
