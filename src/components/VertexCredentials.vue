<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  clearVertexCredential, hasVertexCredential, importVertexCredential, loadVertexCredential,
} from '@/api/vertex';

const busy = ref(false);
const message = ref('');
const pastedCredential = ref('');

async function updateCredential(operation: () => Promise<void>) {
  busy.value = true;
  message.value = '';
  try {
    await operation();
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法操作 Vertex AI 凭证';
  } finally {
    busy.value = false;
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
      await importVertexCredential(text);
      pastedCredential.value = '';
    } finally {
      input.value = '';
    }
  });
}

function savePastedCredential() {
  void updateCredential(async () => {
    await importVertexCredential(pastedCredential.value);
    pastedCredential.value = '';
  });
}

onMounted(() => updateCredential(loadVertexCredential));
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
        @click="savePastedCredential">保存凭证</button>
      <button v-if="hasVertexCredential" class="bbi-btn" type="button" :disabled="busy"
        @click="updateCredential(clearVertexCredential)">清除凭证</button>
    </div>
    <span role="status">{{ message || (hasVertexCredential ? '已保存凭证' : '') }}</span>
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
