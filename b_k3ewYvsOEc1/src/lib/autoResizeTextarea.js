export function resizeTextareaElement(element) {
  if (!element) return 0
  element.style.height = 'auto'
  const height = element.scrollHeight
  element.style.height = `${height}px`
  return height
}
