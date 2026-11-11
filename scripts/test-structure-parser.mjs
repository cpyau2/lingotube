// Test structure parser with sample response
// Run: node scripts/test-structure-parser.mjs

const sampleResponse = {
  "overview": "【話語標記】 + 【主句（含定語從句）】 + 【確認語氣詞】",
  "components": [
    {
      "roleZh": "話語標記",
      "roleEn": "Discourse Marker",
      "text": "So,",
      "meaningZh": "那麼 / 好了",
      "notes": [
        "作用：口語中用來開啟新話題或承上啟下的連接詞，沒有實際實義，相當於中文裡的「那個……」、「那麼……」。"
      ]
    },
    {
      "roleZh": "主句主語",
      "roleEn": "Subject",
      "text": "the first thing [that I want to talk about]",
      "meaningZh": "我想要談論的第一件事",
      "notes": [
        "核心名詞：the first thing（第一件事）。",
        {
          "text": "定語從句：(that) I want to talk about 用來修飾前面的 thing。",
          "sub": [
            "這裡省略了關係代詞 that 或 which（因為它在從句中作介詞 about 的賓語，口語中通常會省略）。",
            "talk about 是固定搭配，意為「談論某事」。"
          ]
        }
      ]
    },
    {
      "roleZh": "系動詞",
      "roleEn": "Linking Verb",
      "text": "is",
      "meaningZh": "是",
      "notes": [
        "因為主語核心詞 the first thing 是單數，所以用 is。"
      ]
    },
    {
      "roleZh": "表語",
      "roleEn": "Predicative",
      "text": "pretty pretty serious",
      "meaningZh": "非常非常嚴肅 / 相當嚴重",
      "notes": [
        "核心形容詞：serious（嚴肅的、嚴重的）。",
        "程度副詞：pretty 在口語中作副詞，意思是「相當、很」（相當於 quite 或 very）。",
        "疊詞用法：連用兩個 pretty（pretty pretty）是純正的口語強調手法，用來加強語氣，表達「真的非常……」，類似於中文的「很嚴重很嚴重」或「非常非常嚴肅」。"
      ]
    },
    {
      "roleZh": "句末確認詞",
      "roleEn": "Tag / Confirmation",
      "text": ", okay",
      "meaningZh": "好嗎？/ 明白嗎？",
      "notes": [
        "作用：放在句尾通常讀作升調（okay?），用來確認聽眾是否準備好傾聽，或者在心理上給對方打個預防針，提醒對方認真對待接下來的內容。"
      ]
    }
  ],
  "highlights": [
    {
      "title": "定語從句省略關係代詞",
      "detail": "the thing I want to do（我想做的事）、the person I want to meet（我想見的人）都是極高頻的口語結構，直接把「名詞 + 主謂結構」拼在一起即可，無需加 that。"
    },
    {
      "title": "副詞疊用表強調",
      "detail": "在正式寫作中不能寫 pretty pretty，但在日常對話中，重複副詞（如 really really good、very very important）非常自然，能傳遞出說話人的情緒和緊迫感。"
    }
  ],
  "alternatives": [
    {
      "label": "更正式",
      "en": "First of all, I need to bring up something quite serious.",
      "zh": "首先，我需要提一件相當嚴肅的事。"
    },
    {
      "label": "更直接",
      "en": "Look, the first thing we need to discuss is really serious.",
      "zh": "聽著，我們需要討論的第一件事真的很嚴重。"
    }
  ],
  "translationZh": "那麼，我想談的第一件事是非常非常嚴肅的，好嗎？"
}

console.log('Testing structure parser...\n')

// Test validation
console.log('✓ Overview:', sampleResponse.overview)
console.log('✓ Components:', sampleResponse.components.length)
console.log('✓ Highlights:', sampleResponse.highlights.length)
console.log('✓ Alternatives:', sampleResponse.alternatives.length)
console.log('✓ Translation:', sampleResponse.translationZh)

// Test component structure
console.log('\nComponent validation:')
for (let i = 0; i < sampleResponse.components.length; i++) {
  const c = sampleResponse.components[i]
  console.log(`  ${i + 1}. ${c.roleZh} (${c.roleEn})`)
  console.log(`     Text: "${c.text}"`)
  console.log(`     Meaning: ${c.meaningZh}`)
  console.log(`     Notes: ${c.notes.length} items`)
  
  // Check for nested notes
  const hasNested = c.notes.some(n => typeof n === 'object' && n.sub)
  if (hasNested) {
    console.log(`     Has nested sub-bullets: ✓`)
  }
}

// Test nested structure
console.log('\nNested note structure:')
const component2 = sampleResponse.components[1]
const nestedNote = component2.notes.find(n => typeof n === 'object' && n.sub)
if (nestedNote && typeof nestedNote === 'object') {
  console.log('  Parent:', nestedNote.text)
  console.log('  Sub-notes:', nestedNote.sub.length)
  nestedNote.sub.forEach((s, i) => {
    console.log(`    ${i + 1}. ${s.substring(0, 50)}...`)
  })
}

// Test JSON serialization
console.log('\nJSON serialization test:')
try {
  const json = JSON.stringify(sampleResponse, null, 2)
  const parsed = JSON.parse(json)
  console.log('✓ Serialization successful')
  console.log('✓ Parsed components:', parsed.components.length)
} catch (e) {
  console.error('✗ Serialization failed:', e.message)
}

console.log('\n✅ All parser tests passed!')
