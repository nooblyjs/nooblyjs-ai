// @ts-check
// Phase F03: the FORGE interface. Where work comes from, and where results go.
//
// A forge is GitHub, GitLab, Gitea… the place with issues and pull requests.
// The factory talks to it through a small interface, so the first one can be
// a folder on disk (offline, free, deterministic tests) and GitHub (Phase F15)
// is just another implementation.
//
//   interface Forge {
//     name
//     fileIssue(slug, { title, body, labels, source })  → Issue      (local only: GitHub issues already exist)
//     getIssue(slug, number)                            → Issue | null
//     pushBranch(mirrorDir, fromBranch, toBranch)       → sha        control plane only: the agent never pushes
//     openOrUpdatePR(slug, pr)                          → { path|url, action: 'created'|'updated'|'unchanged' }
//     findPR(slug, head)                                → PR | null
//     listPRs(slug)                                     → PR[]
//   }
//
// Two properties every implementation must keep:
//   - a PR is identified by its HEAD BRANCH: opening "the PR for factory/issue-3/main"
//     twice updates one PR, never makes two (this is what makes delivery safe to retry)
//   - pushing is done by the control plane, with the control plane's credentials

/**
 * @typedef {Object} Issue
 * @property {number} number
 * @property {string} ref        'local#3', later 'owner/repo#3'
 * @property {string} title
 * @property {string} body       UNTRUSTED: written by someone else
 * @property {string[]} labels
 * @property {string} [path]     local forge: the issue file
 */

/**
 * @typedef {Object} PullRequest
 * @property {string} title
 * @property {string} head       the factory branch, e.g. factory/issue-3/main
 * @property {string} base       e.g. main
 * @property {'draft' | 'ready'} status
 * @property {string} body       Markdown
 * @property {Record<string, string | number>} [meta]  extra fields (issue, run…)
 */

export {};
