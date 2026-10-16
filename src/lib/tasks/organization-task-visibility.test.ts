import type { OrganizationTask } from "@/lib/organization-task";
import {
  organizationTaskOpenForUser,
  organizationTaskVisibleToUser,
} from "@/lib/tasks/organization-task-visibility";
import { encodeOrgTaskAssigneeRef } from "@/lib/tasks/organization-task-assignees";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const base: OrganizationTask = {
  id: "t1",
  title: "Test",
  status: "open",
  assignedTo: null,
  organizationId: "c1",
  createdBy: "u1",
};

const ownerCtx = { userId: "owner-1", employeeId: null, canManageAllTasks: false };
const empCtx = { userId: "emp-u1", employeeId: "e1", canManageAllTasks: false };

const allTask: OrganizationTask = { ...base, assignedMode: "all" };
assert(organizationTaskVisibleToUser(allTask, empCtx), "all visible to employee");
assert(organizationTaskOpenForUser(allTask, ownerCtx), "all open for owner without employee");

const singleUser: OrganizationTask = {
  ...base,
  assignedMode: "single",
  assignedTo: encodeOrgTaskAssigneeRef({ userId: "owner-1" }),
};
assert(organizationTaskVisibleToUser(singleUser, ownerCtx), "user assignee visible");
assert(!organizationTaskVisibleToUser(singleUser, empCtx), "other employee hidden");

const allDonePartial: OrganizationTask = {
  ...allTask,
  completedByUserIds: ["emp-u1"],
};
assert(!organizationTaskOpenForUser(allDonePartial, empCtx), "employee done hides for them");
assert(organizationTaskOpenForUser(allDonePartial, ownerCtx), "owner still open");

console.log("ok organization-task-visibility");
