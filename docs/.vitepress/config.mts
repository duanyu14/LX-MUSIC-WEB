import { defineConfig } from 'vitepress'

export default defineConfig({
  base: "/lxserver/",
  head: [
    ['link', { rel: 'icon', href: '/lxserver/icon.svg' }]
  ],
  title: "LX Sync Server",
  description: "一个增强版的 LX Music 数据同步服务端与 Web 播放器",
  themeConfig: {
    logo: '/icon.svg',
    socialLinks: [
      { icon: 'github', link: 'https://github.com/duanyu14/LX-MUSIC-WEB' }
    ],
    search: {
      provider: 'local'
    },
    nav: [
      { text: '首页', link: '/' },
      { text: '用户指南', link: '/guide/getting-started' },
      { text: '配置指南', link: '/guide/configuration' },
      { text: 'API 文档', link: '/api/reference' },
      { text: '关于', link: '/about' }
    ],
    sidebar: [
      {
        text: '用户指南',
        items: [
          { text: '快速开始', link: '/guide/getting-started' }
        ]
      },
      {
        text: '核心功能',
        items: [
          { text: '同步服务器设置', link: '/guide/sync-server' },
          { text: 'Web 播放器指南', link: '/guide/web-player' }
        ]
      },
      {
        text: '配置指南',
        items: [
          { text: '配置文件及环境变量', link: '/guide/configuration' }
        ]
      },
      {
        text: 'API 文档',
        items: [
          { text: '服务端 API 参考', link: '/api/reference' }
        ]
      }
    ],
    footer: {
      message: 'Released under the Apache-2.0 License.',
      copyright: 'Copyright © 2026 烟雨烟中客 & Contributors'
    }
  }
})
