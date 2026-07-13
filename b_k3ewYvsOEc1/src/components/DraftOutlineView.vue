<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps({
  outline: { type: Object, required: true },
})

const emit = defineEmits(['edit'])
const openMenu = ref(-1)
const menuRoot = ref(null)
const cnNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

function numberLabel(index) {
  return cnNumbers[index] || String(index + 1)
}

function closeMenu(event) {
  if (!menuRoot.value?.contains(event.target)) openMenu.value = -1
}

function editOutline() {
  openMenu.value = -1
  emit('edit')
}

onMounted(() => document.addEventListener('click', closeMenu))
onBeforeUnmount(() => document.removeEventListener('click', closeMenu))
</script>

<template>
  <section class="draft-outline-view" aria-label="提纲目录">
    <article v-for="(item, index) in outline.outlineItems" :key="`${index}-${item.title}`" class="outline-view-item">
      <div class="outline-view-handle" aria-hidden="true">⋮⋮</div>
      <div class="outline-view-content">
        <h3>{{ numberLabel(index) }}、{{ item.title }}</h3>
        <p>{{ item.summary }}</p>
        <div v-if="item.children?.length" class="outline-view-children">
          <section v-for="(child, childIndex) in item.children" :key="`${childIndex}-${child.title}`">
            <h4>（{{ numberLabel(childIndex) }}）{{ child.title }}</h4>
            <p>{{ child.summary }}</p>
          </section>
        </div>
      </div>
      <div ref="menuRoot" class="outline-view-menu">
        <button
          type="button"
          aria-label="更多提纲操作"
          :aria-expanded="openMenu === index"
          @click.stop="openMenu = openMenu === index ? -1 : index"
        >•••</button>
        <div v-if="openMenu === index" class="outline-view-popover">
          <button type="button" @click="editOutline">编辑提纲</button>
          <small>进入编辑模式后可复制、调整顺序或删除条目。</small>
        </div>
      </div>
    </article>
  </section>
</template>

<style scoped>
.draft-outline-view { display: grid; gap: 0; margin-top: 22px; border-top: 1px solid #e2e8f0; }
.outline-view-item { display: grid; grid-template-columns: 30px minmax(0, 1fr) 38px; gap: 12px; min-width: 0; padding: 20px 0; border-bottom: 1px solid #e2e8f0; }
.outline-view-handle { padding-top: 2px; color: #94a3b8; font-size: 17px; letter-spacing: -4px; cursor: default; }
.outline-view-content { min-width: 0; }
.outline-view-content h3,
.outline-view-content h4,
.outline-view-content p { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.outline-view-content h3 { color: #172033; font-size: 18px; font-weight: 900; line-height: 1.55; }
.outline-view-content > p { margin-top: 7px; color: #475569; font-size: 14px; line-height: 1.8; }
.outline-view-children { display: grid; gap: 12px; margin-top: 16px; padding-left: 18px; border-left: 3px solid #dbeafe; }
.outline-view-children section { min-width: 0; }
.outline-view-children h4 { color: #334155; font-size: 14px; font-weight: 900; line-height: 1.6; }
.outline-view-children p { margin-top: 5px; color: #64748b; font-size: 13px; line-height: 1.8; }
.outline-view-menu { position: relative; }
.outline-view-menu > button { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: 0; background: transparent; color: #64748b; border-radius: 8px; cursor: pointer; }
.outline-view-menu > button:hover { background: #eff6ff; color: #1d4ed8; }
.outline-view-menu > button:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.2); outline-offset: 2px; }
.outline-view-popover { position: absolute; top: 40px; right: 0; z-index: 9; width: 190px; border: 1px solid #e2e8f0; background: #fff; border-radius: 8px; padding: 6px; box-shadow: 0 14px 28px rgba(15, 23, 42, 0.14); }
.outline-view-popover button { width: 100%; border: 0; background: transparent; color: #334155; border-radius: 6px; padding: 9px; text-align: left; cursor: pointer; font-size: 12px; font-weight: 800; }
.outline-view-popover button:hover { background: #eff6ff; color: #1d4ed8; }
.outline-view-popover small { display: block; padding: 5px 9px 7px; color: #94a3b8; font-size: 10px; line-height: 1.5; }
</style>
