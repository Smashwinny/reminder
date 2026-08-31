import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Link,
  Pill,
  Row,
  Stack,
  Text,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

type OptionKey = "firebase" | "supabase" | "custom" | "p2p";

const options: Record<OptionKey, {
  name: string;
  fit: string;
  strengths: string[];
  costs: string[];
  verdict: string;
}> = {
  firebase: {
    name: "Firebase / Firestore",
    fit: "最快做出 Android + Web 同步",
    strengths: ["客户端自带离线缓存与恢复联网同步", "认证和实时监听成熟", "首版服务器代码很少"],
    costs: ["同一文档并发修改默认最后写入者获胜", "数据与查询模型被 Firestore 绑定", "长期成本和迁移自由度较弱"],
    verdict: "适合追求最快上线，但不适合作为最可控的长期数据底座。",
  },
  supabase: {
    name: "Supabase / Postgres",
    fit: "产品速度、数据可控性与电脑端开发的平衡点",
    strengths: ["标准 Postgres，任务、标签、历史记录容易扩展", "Auth + RLS 可以按用户隔离数据", "Realtime 可通知手机和网页刷新"],
    costs: ["离线队列和冲突策略要由应用明确实现", "Android 端需要从 SharedPreferences 迁移到 Room", "要维护数据库迁移和安全策略"],
    verdict: "推荐。对这个产品而言，长期可控性比少写一点首版代码更重要。",
  },
  custom: {
    name: "自建 API + Postgres",
    fit: "完全掌控协议、部署和成本",
    strengths: ["同步协议和冲突合并可以完全定制", "不绑定 BaaS 平台", "便于未来加入团队、审计、加密等能力"],
    costs: ["认证、鉴权、实时推送、监控和备份都要自己负责", "第一版时间最长", "服务器运维成为持续工作"],
    verdict: "等业务被验证后再考虑；现在容易把精力耗在基础设施上。",
  },
  p2p: {
    name: "局域网 / 点对点同步",
    fit: "无中心云、强调隐私的特定用户",
    strengths: ["可做到数据不进入第三方云", "局域网同步成本低", "技术上可支持自托管"],
    costs: ["手机和电脑不同时在线时很难可靠同步", "NAT、设备发现、冲突和备份复杂", "无法自然承担账号恢复"],
    verdict: "可以成为未来的高级模式，不应作为默认核心路径。",
  },
};

function FlowNode({ title, body, primary }: { title: string; body: string; primary?: boolean }) {
  const theme = useHostTheme();
  return (
    <div style={{ padding: 14, borderRadius: 8, background: primary ? theme.accent.control : theme.fill.secondary, color: primary ? theme.text.onAccent : theme.text.primary }}>
      <Text weight="semibold" style={{ color: "inherit" }}>{title}</Text>
      <Text size="small" style={{ color: "inherit", opacity: 0.8 }}>{body}</Text>
    </div>
  );
}

export default function MultiDeviceSyncArchitecture() {
  const [selected, setSelected] = useCanvasState<OptionKey>("sync-option", "supabase");
  const option = options[selected];

  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 1080, margin: "0 auto" }}>
      <Stack gap={7}>
        <Text tone="secondary" size="small" weight="semibold">渐明 · 核心架构决策</Text>
        <H1>多端同步不是“传一份 JSON”</H1>
        <Text tone="secondary">真正的目标是：手机断网也能立即记录，电脑稍后出现时能拿到完整任务；两端同时修改时，不静默丢掉任何重要变化。</Text>
      </Stack>

      <Grid columns="1fr auto 1fr auto 1fr" gap={10} align="center">
        <FlowNode title="手机 / 电脑" body="所有操作先写本地" />
        <Text tone="tertiary">双向</Text>
        <FlowNode title="同步引擎" body="增量上传、拉取、重试、合并" primary />
        <Text tone="tertiary">双向</Text>
        <FlowNode title="云端账户" body="认证、任务真相、设备游标" />
      </Grid>

      <Callout tone="info" title="推荐原则">
        本地数据库是每台设备的即时读取来源；云端是跨设备汇合点。新增、完成等操作先在本地成功，再异步同步，不能让网络决定用户能否记任务。
      </Callout>

      <Grid columns="280px minmax(0, 1fr)" gap={24} align="start">
        <Stack gap={8}>
          <H2>四种实现路径</H2>
          {(Object.keys(options) as OptionKey[]).map((key) => (
            <Button key={key} variant={selected === key ? "primary" : "secondary"} onClick={() => setSelected(key)}>
              {options[key].name}
            </Button>
          ))}
        </Stack>

        <Card>
          <CardHeader trailing={<Pill active={selected === "supabase"}>{selected === "supabase" ? "推荐" : "备选"}</Pill>}>{option.name}</CardHeader>
          <CardBody>
            <Stack gap={16}>
              <Stack gap={4}>
                <H3>适用定位</H3>
                <Text>{option.fit}</Text>
              </Stack>
              <Grid columns={2} gap={20}>
                <Stack gap={6}>
                  <Text weight="semibold">优势</Text>
                  {option.strengths.map((item) => <Text key={item} size="small">— {item}</Text>)}
                </Stack>
                <Stack gap={6}>
                  <Text weight="semibold">代价</Text>
                  {option.costs.map((item) => <Text key={item} size="small">— {item}</Text>)}
                </Stack>
              </Grid>
              <Divider />
              <Text weight="semibold">{option.verdict}</Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <Stack gap={12}>
        <H2>推荐落地：Room + Outbox + Supabase</H2>
        <Grid columns={4} gap={10}>
          <FlowNode title="1. 本地提交" body="Room 事务写任务和待同步事件" primary />
          <FlowNode title="2. 后台上传" body="WorkManager 联网后重试 Outbox" />
          <FlowNode title="3. 云端合并" body="Postgres 校验用户、版本与操作" />
          <FlowNode title="4. 增量拉取" body="Realtime 唤醒，再按游标补齐变化" />
        </Grid>
        <Text tone="secondary" size="small">Realtime 只负责“有变化”的提示，不作为唯一可靠通道；真正的数据完整性由增量拉取和设备游标保证。</Text>
      </Stack>

      <Grid columns={2} gap={28}>
        <Stack gap={8}>
          <H2>任务模型必须补充</H2>
          <Text><Text weight="semibold">稳定 ID：</Text>UUID，不能继续用当前毫秒时间作为跨端身份。</Text>
          <Text><Text weight="semibold">归属：</Text>user_id，配合行级权限隔离账户。</Text>
          <Text><Text weight="semibold">版本：</Text>updated_at、version、updated_by_device。</Text>
          <Text><Text weight="semibold">删除：</Text>deleted_at 软删除，避免离线设备把已删除任务重新上传回来。</Text>
          <Text><Text weight="semibold">同步：</Text>sync_state、last_synced_version，以及本地 Outbox。</Text>
        </Stack>
        <Stack gap={8}>
          <H2>冲突规则</H2>
          <Text><Text weight="semibold">新增：</Text>UUID 天然合并，两端新增都保留。</Text>
          <Text><Text weight="semibold">完成状态：</Text>完成优先于“已查看”；恢复任务必须是明确操作。</Text>
          <Text><Text weight="semibold">标题/正文：</Text>先用字段级最后修改时间；无法安全合并时保留冲突副本。</Text>
          <Text><Text weight="semibold">删除：</Text>软删除墓碑保留一段时间，并在所有活跃设备确认后清理。</Text>
          <Text><Text weight="semibold">提醒：</Text>云端同步时间，但通知由各设备本地调度，避免重复推送。</Text>
        </Stack>
      </Grid>

      <Stack gap={7}>
        <H2>建议分三阶段</H2>
        <Text><Text weight="semibold">阶段 1：</Text>把 Android 的 SharedPreferences 迁移到 Room，建立 UUID、版本字段和 Outbox；此时仍可完全离线。</Text>
        <Text><Text weight="semibold">阶段 2：</Text>接 Supabase Auth、tasks 表、RLS、增量同步和冲突测试；先验证两台 Android 设备。</Text>
        <Text><Text weight="semibold">阶段 3：</Text>做响应式 Web/PWA 电脑端，共用账户和同步协议；再考虑桌面客户端。</Text>
      </Stack>

      <Text tone="tertiary" size="small">
        依据：<Link href="https://developer.android.com/topic/architecture/data-layer/offline-first">Android 离线优先指南</Link> · <Link href="https://supabase.com/docs/guides/auth">Supabase Auth</Link> · <Link href="https://supabase.com/docs/guides/realtime/subscribing-to-database-changes">Supabase Realtime</Link> · <Link href="https://firebase.google.com/docs/firestore/manage-data/enable-offline">Firestore 离线能力</Link>
      </Text>
    </Stack>
  );
}
