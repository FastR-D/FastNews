import {
  BookOpen,
  ChartNoAxesCombined,
  GraduationCap,
  LayoutDashboard,
  Mail,
  Newspaper,
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
    to: '/secnews/',
    label: '安全资讯',
    icon: Newspaper,
    group: '发现与研究',
    description: '安全资讯',
  },
  {
    to: '/field-briefing/',
    label: '领域导读',
    icon: BookOpen,
    group: '发现与研究',
    description: '领域导读',
  },
  {
    to: '/summary-brief/',
    label: '总结汇报',
    icon: ChartNoAxesCombined,
    group: '发现与研究',
    description: '总结汇报',
  },
  { to: '/inbox/', label: '私信', icon: Mail, group: '我的研究', description: '私信' },
  { to: '/authors', label: '关注作者', icon: Users, group: '我的研究', description: '关注作者' },
]
export function currentPage(path: string) {
  return (
    navigation.find((item) =>
      item.to === '/'
        ? path === '/' || path === '/index.html'
        : path.startsWith(item.to.replace(/\/$/, '')),
    ) || {
      to: '/login',
      label: path.startsWith('/admin') ? '用户管理' : '账号设置',
      icon: UserRound,
      group: '个人空间',
      description: 'FastNews 账号',
    }
  )
}
