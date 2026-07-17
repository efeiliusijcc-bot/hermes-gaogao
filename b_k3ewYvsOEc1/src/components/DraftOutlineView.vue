<script setup>
defineProps({
  outline: { type: Object, required: true },
})

const cnNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

function numberLabel(index) {
  return cnNumbers[index] || String(index + 1)
}
</script>

<template>
  <section class="draft-outline-view" aria-label="最终提纲">
    <header class="draft-outline-summary">
      <dl>
        <div><dt>建议标题</dt><dd>{{ outline.reportTitle || '未填写' }}</dd></div>
        <div><dt>主题立意</dt><dd>{{ outline.reportTheme || '未填写' }}</dd></div>
        <div><dt>核心判断</dt><dd>{{ outline.coreArgument || '未填写' }}</dd></div>
      </dl>
    </header>

    <div class="draft-outline-directory">
      <article v-for="(item, index) in outline.outlineItems" :key="`${index}-${item.title}`" class="outline-view-item">
        <span>{{ numberLabel(index) }}</span>
        <div class="outline-view-content">
          <h3>{{ item.title }}</h3>
          <p>{{ item.summary }}</p>
          <div v-if="item.children?.length" class="outline-view-children">
            <section v-for="(child, childIndex) in item.children" :key="`${childIndex}-${child.title}`">
              <h4>{{ index + 1 }}.{{ childIndex + 1 }} {{ child.title }}</h4>
              <p>{{ child.summary }}</p>
            </section>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.draft-outline-view { min-width: 0; }
.draft-outline-summary { padding-bottom: 20px; border-bottom: 1px solid #dfe4ea; }
.draft-outline-summary dl { display: grid; gap: 14px; margin: 0; }
.draft-outline-summary dl > div { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 14px; }
.draft-outline-summary dt { color: #737d8b; font-size: 12px; font-weight: 750; }
.draft-outline-summary dd { margin: 0; color: #202733; font-size: 14px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.draft-outline-directory { margin-top: 6px; }
.outline-view-item { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 12px; padding: 21px 0; border-bottom: 1px solid #e3e7ec; }
.outline-view-item > span { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: #edf3fb; color: #315f9d; border-radius: 7px; font-size: 12px; font-weight: 750; }
.outline-view-content { min-width: 0; }
.outline-view-content h3, .outline-view-content h4, .outline-view-content p { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.outline-view-content h3 { color: #1d2532; font-size: 17px; line-height: 1.55; }
.outline-view-content > p { margin-top: 7px; color: #536071; font-size: 13px; line-height: 1.8; }
.outline-view-children { display: grid; gap: 13px; margin-top: 15px; padding-left: 15px; border-left: 2px solid #d9e5f7; }
.outline-view-children h4 { color: #344054; font-size: 14px; line-height: 1.6; }
.outline-view-children p { margin-top: 5px; color: #687386; font-size: 13px; line-height: 1.8; }

@media (max-width: 640px) {
  .draft-outline-summary dl > div { grid-template-columns: 1fr; gap: 4px; }
}
</style>
