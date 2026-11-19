<script setup lang="ts">
import { ref } from 'vue';
import { settings } from '@/state/settings';
import { requestVertexCompletion } from '@/api/vertexCompletion';
import { describeFlexTraffic, VERTEX_MODELS, vertexFlexError } from '@/api/vertex';
import VertexCredentials from '@/components/VertexCredentials.vue';

const testing = ref(false);
const result = ref('');

function chooseModel(event: Event) {
  const select = event.target as HTMLSelectElement;
  if (select.value) settings.vertex.model = select.value;
  select.value = '';
}

async function test() {
  testing.value = true;
  result.value = '';
  try {
    const config = { ...settings.vertex };
    const reply = await requestVertexCompletion(config, [
      { role: 'user', content: 'Reply with OK.' },
    ]);
    result.value = '连接成功 · ' + reply.text.slice(0, 40)
      + (config.flex ? ' · ' + describeFlexTraffic(reply.trafficType) : '');
  } catch (error) {
    result.value = error instanceof Error ? error.message : '连接失败';
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div class="vertex-settings">
    <VertexCredentials class="vertex-credentials" />
    <label>
      <span>地区</span>
      <input v-model.trim="settings.vertex.location" class="bbi-input" placeholder="global" />
    </label>
    <div class="vertex-model">
      <label>
        <span>模型</span>
        <input v-model.trim="settings.vertex.model" class="bbi-input" placeholder="输入模型 ID"
          spellcheck="false" autocomplete="off" autocapitalize="off" />
      </label>
      <select class="bbi-select" aria-label="从官方模型列表选择" @change="chooseModel">
        <option value="" disabled selected>从官方模型列表选择</option>
        <option v-for="model in VERTEX_MODELS" :key="model.id" :value="model.id">
          {{ model.id }}{{ model.flex ? ' · Flex' : '' }}
        </option>
      </select>
    </div>
    <label>
      <span>最大输出 token</span>
      <input v-model.number="settings.vertex.maxTokens" class="bbi-input" type="number" min="1" />
    </label>
    <label>
      <span>超时（秒）</span>
      <input v-model.number="settings.vertex.timeoutSec" class="bbi-input" type="number" min="0"
        :max="settings.vertex.flex ? 1800 : undefined" />
      <small>0 为自动：标准 180 秒，Flex 600 秒</small>
    </label>
    <label class="vertex-flex">
      <input v-model="settings.vertex.flex" type="checkbox" class="bbi-checkbox" />
      <span>Flex 模式（限 global 和支持的 Gemini 模型）</span>
    </label>
    <div>
      <button class="bbi-btn" type="button" :disabled="testing || !!vertexFlexError(settings.vertex)" @click="test">{{ testing ? '测试中…' : '测试连接' }}</button>
      <p v-if="vertexFlexError(settings.vertex) || result" role="status">{{ vertexFlexError(settings.vertex) || result }}</p>
    </div>
  </div>
</template>

<style scoped>
.vertex-settings, .vertex-settings label, .vertex-model {
  display: grid;
  gap: 0.55rem;
  min-width: 0;
}
.vertex-model > select {
  min-width: 0;
  width: 100%;
}
.vertex-credentials { grid-column: 1 / -1; }
.vertex-settings .vertex-flex { display: flex; align-items: center; }
@media (min-width: 640px) {
  .vertex-settings { grid-template-columns: 1fr 1fr; }
}
</style>
