import { ref } from 'vue'

const STORAGE_KEY = 'runway_jwt'

// module-level reactive token shared across all component instances
const _token = ref<string>(localStorage.getItem(STORAGE_KEY) ?? '')
const _role = ref<string>(localStorage.getItem('runway_jwt_role') ?? '')
const _username = ref<string>(localStorage.getItem('runway_jwt_username') ?? '')

export function useRunwayJwt() {
  const setToken = (t: string, username?: string, role?: string) => {
    _token.value = t
    localStorage.setItem(STORAGE_KEY, t)
    if (username) { _username.value = username; localStorage.setItem('runway_jwt_username', username) }
    if (role)     { _role.value = role;         localStorage.setItem('runway_jwt_role', role) }
  }

  const removeToken = () => {
    _token.value = ''
    _role.value = ''
    _username.value = ''
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem('runway_jwt_role')
    localStorage.removeItem('runway_jwt_username')
  }

  const headers = (): Record<string, string> =>
    _token.value ? { 'Authorization': 'Bearer ' + _token.value } : {}

  return { token: _token, role: _role, username: _username, setToken, removeToken, headers }
}
