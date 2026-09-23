import { Cause, Exit, Match, Option, Predicate } from 'effect';

const isIssuesFound = (cause: Cause.Cause<unknown>): boolean =>
  Option.exists(Cause.findErrorOption(cause), Predicate.isTagged('IssuesFound'));

export const exitCodeOf = (exit: Exit.Exit<unknown, unknown>): number =>
  Exit.match(exit, {
    onSuccess: () => 0,
    onFailure: (cause) =>
      Match.value(cause).pipe(
        Match.when(Cause.hasInterruptsOnly, () => 130),
        Match.when(isIssuesFound, () => 1),
        Match.orElse(() => 2),
      ),
  });
