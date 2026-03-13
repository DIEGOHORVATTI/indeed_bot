import { app } from './app.js'
import { PORT } from '@jobpilot/config'

app.listen(PORT, () => {
  console.log(`JobPilot API rodando em http://localhost:${PORT}`)
})
