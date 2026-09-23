import { MESSAGES } from '../constants/messages.js';
import { FileError } from '../domain/errors.js';

export const formatFileError = FileError.$match({
  FileNotFound: (e) => MESSAGES.PACKAGE_JSON_NOT_FOUND(e.path),
  ParseFailed: (e) => MESSAGES.PACKAGE_JSON_PARSE_ERROR(e.path, e.reason),
  ReadFailed: (e) => MESSAGES.PACKAGE_JSON_READ_ERROR(e.path, e.reason),
});

export const formatSkippedSource = FileError.$match({
  FileNotFound: (e) => MESSAGES.SOURCE_SKIPPED(e.path, MESSAGES.NOT_FOUND),
  ParseFailed: (e) => MESSAGES.SOURCE_SKIPPED(e.path, e.reason),
  ReadFailed: (e) => MESSAGES.SOURCE_SKIPPED(e.path, e.reason),
});
