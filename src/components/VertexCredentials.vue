<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  clearVertexCredential, hasVertexCredential, importVertexCredential, loadVertexCredential,
} from '@/api/vertex';

const props = defineProps<{ channelId: string }>();
const emit = defineEmits<{ (event: 'busy-change', value: boolean): void }>();
const busy = ref(false);
const message = ref('');
const pastedCredential = ref('');

async function updateCredential(operation: () => Promise<void>): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  emit('busy-change', true);
  message.value = '';
  try {
    await operation();
    return true;
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法操作 Vertex AI 凭证';
    return false;
  } finally {
    busy.value = false;
    emit('busy-change', false);
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  void updateCredential(async () => {
    try {
      const text = await file.text().catch(() => {
        throw new Error('无法读取凭证文件，可以粘贴 JSON 内容');
      });
      await importVertexCredential(props.channelId, text);
      pastedCredential.value = '';
    } finally {
      input.value = '';
    }
  });
}

async function savePending() {
  if (!pastedCredential.value.trim()) return true;
  return updateCredential(async () => {
    await importVertexCredential(props.channelId, pastedCredential.value);
    pastedCredential.value = '';
  });
}

defineExpose({ savePending });
onMounted(() => updateCredential(() => loadVertexCredential(props.channelId)));
</script>

<template>
  <div class="vertex-credential">
    <label>
      <span>选择服务账号 JSON 文件</span>
      <!-- 安卓文件选择器可能把 JSON 当成纯文本或通用文件，导入时按内容校验。 -->
      <input class="bbi-input" type="file" :disabled="busy" @change="onFileChange" />
    </label>
    <label>
      <span>粘贴服务账号 JSON</span>
      <textarea
        v-model="pastedCredential"
        class="bbi-input"
        rows="4"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        :disabled="busy"
      />
    </label>
    <div class="vertex-credential-status">
      <button class="bbi-btn" type="button" :disabled="busy || !pastedCredential.trim()"
        @click="savePending">保存凭证</button>
      <button v-if="hasVertexCredential(channelId)" class="bbi-btn" type="button" :disabled="busy"
        @click="updateCredential(() => clearVertexCredential(channelId))">清除凭证</button>
    </div>
    <span role="status">{{ message || (hasVertexCredential(channelId) ? '已保存凭证' : '') }}</span>
  </div>
</template>

<style scoped>
.vertex-credential, .vertex-credential label {
  display: grid;
  gap: 0.4rem;
  min-width: 0;
}
.vertex-credential-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.55rem;
  font-size: 0.9em;
}
.vertex-credential input,
.vertex-credential textarea {
  max-width: 100%;
}
</style>
