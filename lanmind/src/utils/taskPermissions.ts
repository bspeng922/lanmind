import { Project, Task } from '../types';

export const canWriteTask = (task: Task, userId: string, projects: Project[]) => {
  const project = projects.find((item) => item.id === task.projectId);
  if (project && (project.createdBy === userId || project.admins.includes(userId))) return true;
  if (task.creatorId === userId || task.assigneeId === userId) return true;
  if (project && task.isShared) return project.members.includes(userId) || project.admins.includes(userId);
  return !task.isShared && (task.sharedWith || []).includes(userId);
};
