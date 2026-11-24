// One one-time EventBridge Scheduler schedule per post target: at(<time>) -> publisher Lambda.
// Local dev (STORE=file): nothing to create; the poller in instrumentation.js picks up due targets.
import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { LOCAL, awsConfig } from './env.js';

let _sch, _lambda;
const sch = () => (_sch ??= new SchedulerClient(awsConfig()));
const lambda = () => (_lambda ??= new LambdaClient(awsConfig()));

/** Arrange for target.runAt to trigger a publish. Returns the schedule name (or null). */
export async function scheduleTarget(target) {
  if (LOCAL) return null;
  const when = new Date(target.runAt);
  const payload = JSON.stringify({ targetId: target.id });

  // Scheduler only accepts future times; "post now" / imminent posts go straight to the Lambda.
  if (when.getTime() - Date.now() < 60_000) {
    await lambda().send(new InvokeCommand({
      FunctionName: process.env.FUNCTION_ARN, InvocationType: 'Event', Payload: payload,
    }));
    return null;
  }

  const name = `t-${target.id}-${Math.floor(when.getTime() / 1000)}`;
  await sch().send(new CreateScheduleCommand({
    Name: name,
    GroupName: process.env.SCHEDULE_GROUP,
    ScheduleExpression: `at(${when.toISOString().slice(0, 19)})`,
    ScheduleExpressionTimezone: 'UTC',
    FlexibleTimeWindow: { Mode: 'OFF' },
    ActionAfterCompletion: 'DELETE',
    Target: { Arn: process.env.FUNCTION_ARN, RoleArn: process.env.SCHEDULER_ROLE_ARN, Input: payload },
  }));
  return name;
}

export async function unschedule(name) {
  if (LOCAL || !name) return;
  try {
    await sch().send(new DeleteScheduleCommand({ Name: name, GroupName: process.env.SCHEDULE_GROUP }));
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e; // already fired / deleted
  }
}
