#!/usr/bin/env bash
# Merges the owner's open pull requests across every repo they own, so nobody
# has to approve a PR (owner rule, ~/SWE/AGENTS.md). Runs from a timer on one
# host (install-pr-automerge.sh); uses that host's `gh` login.
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
set -uo pipefail
dry=false
[ "${1:-}" = --dry-run ] && dry=true
me=$(gh api user --jq .login) || exit 1

gh search prs --owner "$me" --state open --archived=false --limit 200 \
  --json repository,number,author,isDraft \
  --jq '.[] | select(.isDraft | not) | [.repository.nameWithOwner, .number, .author.login] | @tsv' |
  while IFS=$'\t' read -r repo number author; do
    case "$author" in
      "$me") need_checks=false ;;
      app/dependabot | dependabot*) need_checks=true ;;
      *) continue ;;
    esac
    pr=$(gh pr view "$number" --repo "$repo" --json mergeable,statusCheckRollup,title) || continue
    title=$(jq -r .title <<< "$pr")
    [ "$(jq -r .mergeable <<< "$pr")" = MERGEABLE ] || {
      echo "skip $repo#$number ($(jq -r .mergeable <<< "$pr" | tr A-Z a-z)): $title"
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
  done
