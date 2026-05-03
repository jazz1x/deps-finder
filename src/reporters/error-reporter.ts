import { match } from 'ts-pattern';
import { MESSAGES } from '../constants/messages.js';
import type { FileError } from '../domain/errors.js';

export const formatFileError = (error: FileError): string =>
  match(error)
    .with({ type: 'FILE_NOT_FOUND' }, (e) => MESSAGES.PACKAGE_JSON_NOT_FOUND(e.path))
    .with({ type: 'PARSE_ERROR' }, (e) =>
      MESSAGES.PACKAGE_JSON_PARSE_ERROR(e.path, e.error.message),
    )
    .with({ type: 'READ_ERROR' }, (e) => MESSAGES.PACKAGE_JSON_READ_ERROR(e.path, e.error.message))
    .exhaustive();
