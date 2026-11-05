import { Page, SoonPanel } from '../components/Page'

export default function Topics() {
  return (
    <Page title="主題收藏">
      <SoonPanel icon="🗂️" title="自動主題分組" milestone="M3">
        會把你收藏的生字、句子，以及目前觀看的影片，自動按主題（例如「心理 · 自信」「科技」「日常對話」）分組。需要 AI 服務，之後會在「設定」中加入你的 API key。
      </SoonPanel>
    </Page>
  )
}
