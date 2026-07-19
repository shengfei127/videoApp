<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'

import { useAppStore } from '@/stores/appStore'

onLaunch(() => {
  void useAppStore().initialize()
})
</script>

<style lang="scss">
@use '@/styles/tokens.scss' as *;
</style>
