<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number | string; strokeWidth?: number | string }>(), { size: 22 })
</script>

<template>
  <image class="app-icon" :src="`/static/icons/${name}.png`" mode="aspectFit"
    :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true" />
</template>

<style scoped>
.app-icon { display: inline-block; flex-shrink: 0; vertical-align: middle; }
</style>
