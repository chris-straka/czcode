#!/usr/bin/env bash
# Merges the owner's open pull requests across every repo they own, so nobody
# has to approve a PR (owner rule, ~/SWE/AGENTS.md). Runs from a timer on one
# host (the pr-automerge host job, host-jobs.sh); uses that host's `gh` login.
#
#   pr-automerge.sh            # merge what's ready
#   pr-automerge.sh --dry-run  # only say what it would do
#
# A PR is merged when it is open, not a draft, has no conflicts, and:
# - the agents opened it (author = the gh account): every check that ran
#   passed, or it has no checks at all;
# - Dependabot opened it: at least one check ran and every check passed, so an
#   untested dependency bump never lands blind.
# A PR with no checks in a repo that has CI workflows waits: CI hasn't
# reported yet (or isn't running), and that is not the same as "no CI".
# Squash merge (falling back to a merge commit), then delete the branch.
# A Dependabot PR with conflicts gets one "@dependabot rebase" comment; it
# isn't repeated while that comment stands, so a rebase Dependabot can't do
# waits for a person.
set -uo pipefail
dry=false
[ "${1:-}" = --dry-run ] && dry=true
me=$(gh api user --jq .login) || exit 1
out=$(mktemp)
trap 'rm -f "$out"' EXIT

gh search prs --owner "$me" --state open --archived=false --limit 200 \
  --json repository,number,author,isDraft \
  --jq '.[] | select(.isDraft | not) | [.repository.nameWithOwner, .number, .author.login] | @tsv' |
  while IFS=$'\t' read -r repo number author; do
    case "$author" in
      "$me") need_checks=false ;;
      app/dependabot | dependabot*) need_checks=true ;;
      *) continue ;;
    esac
    pr=$(gh pr view "$number" --repo "$repo" --json mergeable,statusCheckRollup,title,comments) || continue
    title=$(jq -r .title <<< "$pr")
    if $need_checks && [ "$(jq -r .mergeable <<< "$pr")" = CONFLICTING ]; then
      if jq -e --arg me "$me" 'any(.comments[]; .author.login == $me and (.body | test("^@dependabot rebase")))' <<< "$pr" > /dev/null; then
        echo "skip $repo#$number (conflicting; already asked Dependabot to rebase): $title"
      elif $dry; then
        echo "would ask Dependabot to rebase $repo#$number (conflicting): $title"
      elif gh pr comment "$number" --repo "$repo" --body "@dependabot rebase" > /dev/null; then
        echo "asked Dependabot to rebase $repo#$number (conflicting): $title"
      else
        echo "FAILED to comment on $repo#$number: $title" >&2
      fi
      continue
    fi
    [ "$(jq -r .mergeable <<< "$pr")" = MERGEABLE ] || {
      echo "skip $repo#$number ($(jq -r .mergeable <<< "$pr" | tr '[:upper:]' '[:lower:]')): $title"
      continue
    }
    # Checks: CheckRun entries carry status+conclusion, StatusContext entries carry state.
    read -r total pending failed < <(jq -r '
      [.statusCheckRollup[]? | {
        done: ((.status // "COMPLETED") == "COMPLETED" and (.state // "SUCCESS") != "PENDING"),
        ok: (((.conclusion // .state // "") | ascii_upcase) as $c
             | ["SUCCESS", "NEUTRAL", "SKIPPED"] | index($c) != null)
      }] | [length, (map(select(.done | not)) | length), (map(select(.done and (.ok | not))) | length)]
      | @tsv' <<< "$pr")
    if [ "$pending" -gt 0 ]; then
      echo "wait $repo#$number ($pending checks running): $title"
      continue
    fi
    if [ "$failed" -gt 0 ]; then
      echo "skip $repo#$number ($failed checks failed): $title"
      continue
    fi
    if [ "$total" -eq 0 ] && [ "$(gh api "repos/$repo/actions/workflows" --jq .total_count 2> /dev/null || echo 0)" -gt 0 ]; then
      echo "wait $repo#$number (repo has CI but no checks reported): $title"
      continue
    fi
    if $need_checks && [ "$total" -eq 0 ]; then
      echo "skip $repo#$number (Dependabot PR with no checks): $title"
      continue
    fi
    if $dry; then
      echo "would merge $repo#$number ($total checks green): $title"
    elif gh pr merge "$number" --repo "$repo" --squash --delete-branch > /dev/null 2>&1 ||
      gh pr merge "$number" --repo "$repo" --merge --delete-branch > /dev/null 2>&1; then
      echo "merged $repo#$number: $title"
    else
      echo "FAILED to merge $repo#$number: $title" >&2
    fi
  done 2>&1 | tee "$out"
count() { grep -c "^$1" "$out"; }
echo "$(count merged) merged, $(count asked) rebases asked for, $(count wait) waiting, $(count skip) skipped, $(count FAILED) failed"
[ "$(count FAILED)" -eq 0 ]
