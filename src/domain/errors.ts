import { Data } from 'effect';

export type FileError = Data.TaggedEnum<{
  FileNotFound: { readonly path: string };
  ReadFailed: { readonly path: string; readonly reason: string };
  ParseFailed: { readonly path: string; readonly reason: string };
}>;

export const FileError = Data.taggedEnum<FileError>();

// Not an error: Command.run discards the handler's value, so a failing check travels the error channel.
export type RunOutcome = Data.TaggedEnum<{
  IssuesFound: { readonly total: number };
}>;

export const { IssuesFound } = Data.taggedEnum<RunOutcome>();

export type RunFailure = Data.TaggedEnum<{
  InstallRequired: { readonly root: string };
  PlugAndPlayUnread: { readonly root: string };
}>;

export const { InstallRequired, PlugAndPlayUnread } = Data.taggedEnum<RunFailure>();
