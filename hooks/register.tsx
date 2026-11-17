import type { Register } from 'claude-code'

import { makeColors } from './make-colors.js'
import { SCENE as POND } from './pond.js'

const SCENE_ID = 'pond'
const ALT = 'Pixel-art koi pond seen from above, with raindrops, lily pads and floating cherry blossoms'

// Koi pond: pixel art seen from above. Teal water, koi-orange accent.
const colors = makeColors({
  label: 'Koi pond',
  only: 'dark',
  roles: { accent: '#ec7b2f', danger: '#d9442c', success: '#6aa64f', warning: '#e9b440', pro: '#e996b1' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0f2326',
        'surface-1': '#132a2d',
        'surface-2': '#173033',
        'surface-3': '#1a3437',
        'text-primary': '#e8f0ec',
        'text-secondary': '#bfd0c9',
        'text-muted': '#97aca5',
      },
    },
  },
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = colors.problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }
    const set = await $.theme.set({
      colors: colors.theme,
      // Light blur keeps the pixels readable behind the panels.
      backdrop: { scene: SCENE_ID, glass: { blur: 6, tint: '#0f2326', opacity: 0.55 } },
    })

    // The client may attach after session.start; clear any earlier reason once drawn.
    $.ui.status(set.isDrawn ? undefined : set.reason)

    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    if (e.props.scene !== SCENE_ID) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)

    return <Svg source={POND} alt={ALT} isInteractive />
  })
}
