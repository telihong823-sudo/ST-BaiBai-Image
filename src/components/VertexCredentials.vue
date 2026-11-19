<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  clearVertexCredential, importVertexCredential, loadVertexCredential, vertexCredentialProject,
} from '@/api/vertex';

const busy = ref(false);
const message = ref('');

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
  input.value = '';
  if (file) void updateCredential(() => importVertexCredential(file));
}

onMounted(() => updateCredential(loadVertexCredential));
</script>

<template>
  <div class="vertex-credential">
    <label>
      <span>服务账号 JSON 凭证</span>
      <input class="bbi-input" type="file" accept=".json,application/json" :disabled="busy" @change="onFileChange" />
    </label>
    <div class="vertex-credential-status">
      <span role="status">{{ message || (vertexCredentialProject ? '已导入 · ' + vertexCredentialProject : '凭证保存在当前客户端') }}</span>
      <button v-if="vertexCredentialProject" class="bbi-btn" type="button" :disabled="busy"
        @click="updateCredential(clearVertexCredential)">清除凭证</button>
    </div>
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
.vertex-credential input {
  max-width: 100%;
}
</style>
