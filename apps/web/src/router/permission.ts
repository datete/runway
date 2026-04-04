import type { Router } from 'vue-router'
import { useAuthStoreWithout } from '@/store/modules/auth'

// Routes that require Runway JWT authentication
const RUNWAY_JWT_ROUTES = ['/video', '/dance', '/wav']

function requiresRunwayJwt(path: string): boolean {
  return RUNWAY_JWT_ROUTES.some(prefix => path === prefix || path.startsWith(prefix + '/'))
}

export function setupPageGuard(router: Router) {
  router.beforeEach(async (to, from, next) => {
    // --- Runway JWT guard for video-related routes ---
    if (requiresRunwayJwt(to.path)) {
      const token = localStorage.getItem('runway_jwt')
      if (!token) {
        // Set meta flag so the page component can show login modal
        to.meta.needRunwayLogin = true
      }
    }

    // --- Original ChatGPT Web session guard ---
    const authStore = useAuthStoreWithout()
    if (!authStore.session) {
      try {
        const data = await authStore.getSession()
        if (String(data.auth) === 'false' && authStore.token)
          authStore.removeToken()
        if (to.path === '/500')
          next({ name: 'Root' })
        else
          next()
      }
      catch (error) {
        if (to.path !== '/500')
          next({ name: '500' })
        else
          next()
      }
    }
    else {
      next()
    }
  })
}
