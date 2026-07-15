export const USER_PAGE_SIZE = 10

function normalizedText(value) {
  return String(value ?? '').toLowerCase()
}

export function filterUsers(users, keyword) {
  const normalizedKeyword = normalizedText(keyword).trim()
  const source = Array.isArray(users) ? users : []
  if (!normalizedKeyword) return source

  return source.filter((user) => [
    user?.username,
    user?.email,
    user?.displayName,
    user?.remark,
    user?.notes,
    user?.description,
  ].some((value) => normalizedText(value).includes(normalizedKeyword)))
}

export function paginateUsers(users, requestedPage, pageSize = USER_PAGE_SIZE) {
  const source = Array.isArray(users) ? users : []
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : USER_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(source.length / safePageSize))
  const numericPage = Number.isFinite(Number(requestedPage)) ? Math.floor(Number(requestedPage)) : 1
  const page = Math.min(totalPages, Math.max(1, numericPage))
  const start = (page - 1) * safePageSize

  return {
    items: source.slice(start, start + safePageSize),
    page,
    pageSize: safePageSize,
    total: source.length,
    totalPages,
  }
}
