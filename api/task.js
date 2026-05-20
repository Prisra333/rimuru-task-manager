export default async function handler(req, res) {
  const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL
  const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
  const API_KEY = "rimuru-task-2026"
  res.setHeader("Access-Control-Allow-Origin","*")
  res.setHeader("Access-Control-Allow-Methods","GET,POST,PATCH,DELETE,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers","Content-Type,X-API-Key")
  if (req.method==="OPTIONS") return res.status(200).end()
  if (req.headers["x-api-key"]!==API_KEY) return res.status(401).json({error:"Unauthorized"})
  async function redis(args) {
    const r = await fetch(UPSTASH_URL+"/"+args.map(encodeURIComponent).join("/"),{headers:{Authorization:"Bearer "+UPSTASH_TOKEN}})
    return r.json()
  }
  if (req.method==="POST") {
    const {task,type}=req.body||{}
    if (!task) return res.status(400).json({error:"task required"})
    const id=Date.now()+"-"+Math.random().toString(36).slice(2,8)
    const data={id,task,type:type||"general",status:"pending",created_at:new Date().toISOString()}
    await redis(["SET","task:"+id,JSON.stringify(data)])
    await redis(["LPUSH","tasks:all",id])
    return res.status(201).json(data)
  }
  if (req.method==="GET") {
    const r=await redis(["LRANGE","tasks:all","0","99"])
    const ids=r.result||[]
    const tasks=await Promise.all(ids.map(async id=>{const r2=await redis(["GET","task:"+id]);return r2.result?JSON.parse(r2.result):null}))
    return res.status(200).json(tasks.filter(Boolean))
  }
  if (req.method==="PATCH") {
    const {id,status}=req.body||{}
    const r=await redis(["GET","task:"+id])
    if (!r.result) return res.status(404).json({error:"Not found"})
    const data={...JSON.parse(r.result),status}
    await redis(["SET","task:"+id,JSON.stringify(data)])
    return res.status(200).json(data)
  }
  res.status(405).json({error:"Method not allowed"})
}