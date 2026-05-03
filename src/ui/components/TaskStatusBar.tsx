/**
 * TaskStatusBar — TUI 任务状态栏组件
 *
 * 显示规则：
 * - 无 running/pending 任务时：不渲染，不占空间
 * - 有任务时：在对话区顶部显示一行
 * - 格式：⟳ {任务名}  ▓▓▓▓░░░░  60%
 * - 多个任务时：只显示最新的一个，右侧加 (+N 个任务) 提示
 * - 任务完成时：切换为 ✓ {任务名} 已完成，3 秒后自动隐藏
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { AniTaskManager } from '../../ani/taskManager.js';
import type { TaskMeta } from '../../ani/taskManager.js';

export const TaskStatusBar: React.FC = () => {
  const [tasks, setTasks] = useState<TaskMeta[]>([]);
  const [completedTask, setCompletedTask] = useState<TaskMeta | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskManagerRef = useRef<AniTaskManager | null>(null);
  const prevRunningIdsRef = useRef<Set<string>>(new Set());

  // 轮询任务状态
  useEffect(() => {
    if (!taskManagerRef.current) {
      taskManagerRef.current = new AniTaskManager();
    }

    const poll = async () => {
      try {
        const allTasks = await taskManagerRef.current!.listTasks();
        const active = allTasks.filter(t => t.status === 'running' || t.status === 'pending');

        // 检测刚完成/失败的任务
        const currentRunningIds = new Set(active.map(t => t.id));
        for (const prevId of prevRunningIdsRef.current) {
          if (!currentRunningIds.has(prevId)) {
            const completed = allTasks.find(t => t.id === prevId);
            if (completed && (completed.status === 'done' || completed.status === 'failed')) {
              setCompletedTask(completed);
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
              hideTimerRef.current = setTimeout(() => setCompletedTask(null), 3000);
            }
          }
        }
        prevRunningIdsRef.current = currentRunningIds;

        setTasks(allTasks);
      } catch { /* 忽略轮询错误 */ }
    };

    poll();
    const interval = setInterval(poll, 2000);

    return () => {
      clearInterval(interval);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const activeTasks = tasks.filter(t => t.status === 'running' || t.status === 'pending');

  // 无活跃任务且无刚完成任务：不渲染
  if (activeTasks.length === 0 && !completedTask) return null;

  // 显示刚完成的任务
  if (completedTask && activeTasks.length === 0) {
    const icon = completedTask.status === 'done' ? '✓' : '✗';
    const label = completedTask.status === 'done' ? '已完成' : '失败';
    return (
      <Box marginX={2} marginBottom={0}>
        <Text color={completedTask.status === 'done' ? 'green' : 'red'}>
          {icon} {completedTask.name} {label}
        </Text>
      </Box>
    );
  }

  // 显示最新活跃任务
  const latest = activeTasks[activeTasks.length - 1];
  const progressPercent = Math.round(latest.progress * 100);
  const barWidth = 10;
  const filled = Math.round(latest.progress * barWidth);
  const bar = '▓'.repeat(filled) + '░'.repeat(barWidth - filled);
  const extra = activeTasks.length > 1 ? `  (+${activeTasks.length - 1} 个任务)` : '';

  return (
    <Box marginX={2} marginBottom={0}>
      <Text color="yellow">⟳ {latest.name}  {bar}  {progressPercent}%{extra}</Text>
    </Box>
  );
};
