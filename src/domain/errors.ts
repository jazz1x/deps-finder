import { Data } from 'effect';

export type FileError = Data.TaggedEnum<{
  FileNotFound: { readonly path: string };
  ReadFailed: { readonly path: string; readonly reason: string };
  ParseFailed: { readonly path: string; readonly reason: string };
}>;

export const FileError = Data.taggedEnum<FileError>();
