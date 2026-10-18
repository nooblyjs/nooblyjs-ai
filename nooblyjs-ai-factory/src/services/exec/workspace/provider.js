// @ts-check
// Phase F02: the WorkspaceProvider interface.
//
// Where an agent works is a detail the rest of the factory shouldn't care
// about. Today: a git worktree on this machine, isolated by the harness's OS
// sandbox. Phase F23: a container, maybe on another machine. Both answer the
// same two questions: "give me a clean place to work" and "I'm done with it".
//
//   interface WorkspaceProvider {
//     acquire({ repo, base?, name? }) → Workspace { id, path, branch, baseSha, harnessHome, harnessSettings, config, … }
//     release(workspace, { keep?, message? }) → { commits, stat, branch, kept }
//   }
import { acquireWorkspace, releaseWorkspace } from './worktree.js';

/** @typedef {{ name: string, acquire: typeof acquireWorkspace, release: typeof releaseWorkspace }} WorkspaceProvider */

/** @type {WorkspaceProvider} */
export const worktreeProvider = { name: 'worktree', acquire: acquireWorkspace, release: releaseWorkspace };
