/**
 * 内置工具汇总
 */

export { readFileTool } from './readFile.js';
export { writeFileTool } from './writeFile.js';
export { editFileTool } from './editFile.js';
export { listFilesTool } from './listFiles.js';
export { searchFilesTool } from './searchFiles.js';
export { getCurrentDirectoryTool } from './getCurrentDirectory.js';
export { getGitInfoTool } from './getGitInfo.js';
export { getCurrentDateTimeTool } from './getCurrentDateTime.js';
export { executeCommandTool, isDangerousCommand } from './executeCommand.js';
export { askUserTool, setQuestionDialogCallback } from './askUser.js';
export { todoWriteTool, todoReadTool, resetTodos } from './todo.js';
export { sequentialThinkingTool } from './sequentialThinking.js';
export { loadSkillTool } from './loadSkill.js';
export { writeUserProfileTool } from './writeUserProfile.js';
export { writeJobFlowTool } from './writeJobFlow.js';
export { writeProjectFilesTool } from './writeProjectFiles.js';
export { dispatchTaskTool, getTaskManager } from './dispatchTask.js';

import { readFileTool } from './readFile.js';
import { writeFileTool } from './writeFile.js';
import { editFileTool } from './editFile.js';
import { listFilesTool } from './listFiles.js';
import { searchFilesTool } from './searchFiles.js';
import { getCurrentDirectoryTool } from './getCurrentDirectory.js';
import { getGitInfoTool } from './getGitInfo.js';
import { getCurrentDateTimeTool } from './getCurrentDateTime.js';
import { executeCommandTool } from './executeCommand.js';
import { askUserTool } from './askUser.js';
import { todoWriteTool, todoReadTool } from './todo.js';
import { sequentialThinkingTool } from './sequentialThinking.js';
import { loadSkillTool } from './loadSkill.js';
import { writeUserProfileTool } from './writeUserProfile.js';
import { writeJobFlowTool } from './writeJobFlow.js';
import { writeProjectFilesTool } from './writeProjectFiles.js';
import { dispatchTaskTool } from './dispatchTask.js';

/**
 * 所有内置工具列表
 */
export const builtinTools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listFilesTool,
  searchFilesTool,
  getCurrentDirectoryTool,
  getGitInfoTool,
  getCurrentDateTimeTool,
  executeCommandTool,
  askUserTool,
  todoWriteTool,
  todoReadTool,
  sequentialThinkingTool,
  loadSkillTool,
  writeUserProfileTool,
  writeJobFlowTool,
  writeProjectFilesTool,
  dispatchTaskTool,
];
