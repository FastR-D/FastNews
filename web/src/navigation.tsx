import {
  BookOpen,
  ChartNoAxesCombined,
  GraduationCap,
  LayoutDashboard,
  Mail,
  Newspaper,
  Library,
  TrendingUp,
  Users,
  UserRound,
} from 'lucide-react'

export const navigation = [
  {
    to: '/',
    label: '总览',
    icon: LayoutDashboard,
    group: '工作空间',
    description: '安全研究报告工作台',
  },
  {
    to: '/top-conf/',
    label: '顶会报告',
    icon: GraduationCap,
    group: '发现与研究',
    description: '顶会论文总结',
  },
  {
    to: '/coverage/',
    label: '数据覆盖',
    icon: ChartNoAxesCombined,
    group: '发现与研究',
    description: '论文与摘要采集覆盖',
  },
  {
    to: '/updates/',
    label: '研究资讯',
    icon: Newspaper,
    group: '发现与研究',
    description: '安全与 AI 研究动态',
  },
  {
    to: '/sources/',
    label: '信源目录',
    icon: Library,
    group: '发现与研究',
    description: '官方、学术与社区推荐信源',
  },
  {
    to: '/brief/',
    label: '领域导读',
    icon: BookOpen,
    group: '发现与研究',
    description: '领域导读',
  },
  {
    to: '/arxiv/',
    label: 'arXiv 导读',
    icon: BookOpen,
    group: '发现与研究',
    description: 'arXiv 最新导读',
  },
  {
    to: '/trends/',
    label: '研究趋势',
    icon: TrendingUp,
    group: '发现与研究',
    description: 'arXiv 研究方向热度',
  },
  {
    to: '/summary/',
    label: '总结汇报',
    icon: ChartNoAxesCombined,
    group: '发现与研究',
    description: '总结汇报',
  },
  { to: '/inbox/', label: '私信', icon: Mail, group: '我的研究', description: '私信' },
  { to: '/following/', label: '关注作者', icon: Users, group: '我的研究', description: '关注作者' },
]
export function currentPage(path: string) {
  return (
    navigation.find((item) =>
      item.to === '/' ? path === '/' : path.startsWith(item.to.replace(/\/$/, '')),
    ) || {
      to: path,
      label: path.startsWith('/admin/jobs/')
        ? '进程管理'
        : path.startsWith('/admin/users')
          ? '用户管理'
          : path.startsWith('/authors/')
            ? '学者'
            : path.startsWith('/institutions/')
              ? '机构'
              : path.startsWith('/login')
                ? '登录'
                : '账号设置',
      icon: UserRound,
      group: '个人空间',
      description: 'FastNews 账号',
    }
  )
}
