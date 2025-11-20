import type { FileSystemError } from "../types.ts";
import { ERROR_CODE_ENOENT, ERROR_MESSAGE_NOT_FOUND } from "../constants.ts";

export function isNotFoundError(error: unknown): boolean {
  const fsError = error as FileSystemError
  const errorString = String(error)
  const errorMessage = fsError?.message || errorString
  
  return (
    fsError?.code === ERROR_CODE_ENOENT || 
    errorMessage.includes(ERROR_MESSAGE_NOT_FOUND) ||
    errorMessage.includes(ERROR_CODE_ENOENT) ||
    errorString.includes(ERROR_MESSAGE_NOT_FOUND)
  )
}