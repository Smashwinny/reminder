import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  Pill,
  Row,
  Stack,
  Text,
  TextArea,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

type TaskState = "unread" | "seen" | "doing" | "done";
type SortMode = "color" | "created" | "deadline";

type Task = {
  id: number;
  title: string;
  detail: string;
  created: string;
  deadline?: string;
  state: TaskState;
};

const initialTasks: Task[] = [
  { id: 1, title: "复习英语听力课程第 4 章", detail: "整理易错发音，并完成课后练习", created: "今天 08:10", deadline: "今天 21:00", state: "unread" },
  { id: 2, title: "阅读《设计心理学》第二章", detail: "至少读 20 页，摘录 3 个观点", created: "昨天 22:30", state: "seen" },
  { id: 3, title: "完成算法练习：二叉树", detail: "先做 2 道基础题，不要求一次学完", created: "昨天 18:20", deadline: "明天", state: "doing" },
  { id: 4, title: "整理本周学习笔记", detail: "合并重复内容，标记下周复习项", created: "周一 09:15", state: "done" },
];

const stateOrder: Record<TaskState, number> = { unread: 0, doing: 1, seen: 2, done: 3 };
const stateLabel: Record<TaskState, string> = { unread: "未查看", seen: "已查看", doing: "进行中", done: "已完成" };

function StateMark({ state }: { state: TaskState }) {
  const theme = useHostTheme();
  const opacity = { unread: 1, doing: 0.76, seen: 0.48, done: 0.2 }[state];
  return (
    <div style={{ width: 8, alignSelf: "stretch", minHeight: 48, borderRadius: 6, background: theme.accent.primary, opacity }} />
  );
}

function TaskRow({ task, onOpen, onStart, onDone }: { task: Task; onOpen: () => void; onStart: () => void; onDone: () => void }) {
  const theme = useHostTheme();
  return (
    <div
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        onOpen();
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "8px minmax(0, 1fr) auto",
        gap: 12,
        padding: "12px 0",
        cursor: "pointer",
        borderBottom: `1px solid ${theme.stroke.tertiary}`,
      }}
    >
      <StateMark state={task.state} />
      <Stack gap={4} style={{ minWidth: 0 }}>
        <Row gap={8} align="center" wrap>
          <Text weight="semibold" style={{ textDecoration: task.state === "done" ? "line-through" : undefined }}>{task.title}</Text>
          <Pill tone={task.state === "done" ? "success" : task.state === "unread" ? "info" : "neutral"}>{stateLabel[task.state]}</Pill>
        </Row>
        <Text tone="secondary" size="small">{task.detail}</Text>
        <Text tone="tertiary" size="small">记录于 {task.created}{task.deadline ? ` · 截止 ${task.deadline}` : " · 无截止时间"}</Text>
      </Stack>
      <Row gap={6} align="center">
        {task.state !== "doing" && task.state !== "done" ? <Button variant="ghost" onClick={onStart}>开始</Button> : null}
        {task.state !== "done" ? <Button variant="primary" onClick={onDone}>完成</Button> : null}
      </Row>
    </div>
  );
}

export default function TaskReminderProduct() {
  const theme = useHostTheme();
  const [tasks, setTasks] = useCanvasState<Task[]>("reminder-product-tasks", initialTasks);
  const [draft, setDraft] = useCanvasState("reminder-product-draft", "");
  const [sort, setSort] = useCanvasState<SortMode>("reminder-product-sort", "color");
  const [showDone, setShowDone] = useCanvasState("reminder-product-show-done", true);

  const update = (id: number, state: TaskState) => setTasks((items) => items.map((item) => item.id === id ? { ...item, state } : item));
  const visible = [...tasks]
    .filter((task) => showDone || task.state !== "done")
    .sort((a, b) => sort === "color" ? stateOrder[a.state] - stateOrder[b.state] : sort === "deadline" ? (a.deadline || "无限期").localeCompare(b.deadline || "无限期") : b.id - a.id);
  const doneCount = tasks.filter((task) => task.state === "done").length;

  const addTask = () => {
    const text = draft.trim();
    if (!text) return;
    setTasks((items) => [{ id: Date.now(), title: text.split("\n")[0], detail: text.split("\n").slice(1).join(" ") || "刚刚粘贴，稍后再整理", created: "刚刚", state: "unread" }, ...items]);
    setDraft("");
  };

  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 1080, margin: "0 auto", color: theme.text.primary }}>
      <Grid columns="minmax(0, 1.55fr) minmax(260px, 0.75fr)" gap={28} align="start">
        <Stack gap={18}>
          <Stack gap={6}>
            <Text tone="secondary" size="small" weight="semibold">产品概念 · 暂定名「渐明」</Text>
            <H1>把“怕忘记”变成“看得见的推进”</H1>
            <Text tone="secondary">复制一段内容，粘贴即成为任务。越需要注意，颜色越深；查看、开始、完成会让颜色逐步变淡，但不会因为误触直接消失。</Text>
          </Stack>

          <Card>
            <CardHeader trailing={<Pill tone="info">核心入口</Pill>}>快速收件箱</CardHeader>
            <CardBody>
              <Stack gap={10}>
                <TextArea value={draft} onChange={setDraft} placeholder="粘贴课程、文章、消息或任何要做的事…" rows={4} />
                <Row justify="space-between" align="center">
                  <Text tone="tertiary" size="small">默认只要求内容；时间、标签可以以后再补。</Text>
                  <Button variant="primary" onClick={addTask}>记录任务</Button>
                </Row>
              </Stack>
            </CardBody>
          </Card>

          <Stack gap={10}>
            <Row justify="space-between" align="center" wrap>
              <H2>任务列表</H2>
              <Row gap={6} wrap>
                <Button variant={sort === "color" ? "primary" : "ghost"} onClick={() => setSort("color")}>按颜色</Button>
                <Button variant={sort === "created" ? "primary" : "ghost"} onClick={() => setSort("created")}>按记录时间</Button>
                <Button variant={sort === "deadline" ? "primary" : "ghost"} onClick={() => setSort("deadline")}>按截止时间</Button>
                <Button variant="ghost" onClick={() => setShowDone((value) => !value)}>{showDone ? "隐藏已完成" : "显示已完成"}</Button>
              </Row>
            </Row>
            <div>{visible.map((task) => <TaskRow key={task.id} task={task} onOpen={() => task.state === "unread" && update(task.id, "seen")} onStart={() => update(task.id, "doing")} onDone={() => update(task.id, "done")} />)}</div>
          </Stack>
        </Stack>

        <Stack gap={18}>
          <Card>
            <CardHeader>今日反馈</CardHeader>
            <CardBody>
              <Stack gap={10}>
                <Text style={{ fontSize: 22 }} weight="bold">已完成 {doneCount} 项</Text>
                <Text tone="secondary" size="small">不做连续打卡惩罚，只记录真实进展。完成得越多，列表越“轻”。</Text>
              </Stack>
            </CardBody>
          </Card>

          <Stack gap={10}>
            <H2>颜色规则</H2>
            {(["unread", "doing", "seen", "done"] as TaskState[]).map((state) => (
              <Row key={state} gap={10} align="stretch">
                <StateMark state={state} />
                <Stack gap={2}>
                  <Text weight="semibold">{stateLabel[state]}</Text>
                  <Text tone="secondary" size="small">{{ unread: "新任务，颜色最深，优先吸引注意", doing: "已经开始，仍保持较明显", seen: "只表示看过，不能等同于完成", done: "完成后最淡，并进入成果记录" }[state]}</Text>
                </Stack>
              </Row>
            ))}
          </Stack>

          <Divider />

          <Stack gap={8}>
            <H2>MVP 范围</H2>
            <Text><Text weight="semibold">必须有：</Text>粘贴新增、颜色状态、查看/开始/完成、排序、搜索、提醒时间、撤销完成。</Text>
            <Text><Text weight="semibold">暂不做：</Text>复杂项目管理、团队协作、AI 自动拆解、积分商城、强制连续打卡。</Text>
            <Text tone="secondary" size="small">首版目标不是管理一切，而是让任务可靠进入视野，并持续给用户完成感。</Text>
          </Stack>
        </Stack>
      </Grid>
    </Stack>
  );
}
