// 🔗 CONEXÃO
const SUPABASE_URL = "tueewgpkotikpyniurlk"
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1ZWV3Z3Brb3Rpa3B5bml1cmxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTk1OTQsImV4cCI6MjA5MDczNTU5NH0.CRGDlx3tIokpMEVj4PD2L1H431JdGwvsAahc8XJfghc"

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

// ==========================
// LOGIN
// ==========================
async function login() {
  const email = document.getElementById("email").value
  const senha = document.getElementById("senha").value

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: senha
  })

  if (error) {
    alert("Erro no login: " + error.message)
    return
  }

  window.location.href = "index.html"
}

// ==========================
// CADASTRO
// ==========================
async function register() {
  const email = document.getElementById("email").value
  const senha = document.getElementById("senha").value

  const { error } = await supabase.auth.signUp({
    email,
    password: senha
  })

  if (error) {
    alert("Erro: " + error.message)
  } else {
    alert("Conta criada! Faça login.")
  }
}

// ==========================
// LOGOUT
// ==========================
async function logout() {
  await supabase.auth.signOut()
  window.location.href = "login.html"
}

// ==========================
// PEGAR USUÁRIO
// ==========================
async function getUser() {
  const { data } = await supabase.auth.getUser()
  return data.user
}

// ==========================
// CRIAR CORRIDA
// ==========================
async function criarCorrida() {
  const valor = parseFloat(document.getElementById("valor").value)
  const participantes = document.getElementById("participantes").value.split(",")

  if (!valor || participantes.length === 0) {
    alert("Preencha tudo")
    return
  }

  const user = await getUser()
  const valorPorPessoa = valor / participantes.length

  // 1. Criar corrida
  const { data: ride, error } = await supabase
    .from("rides")
    .insert({
      created_by: user.id,
      total_value: valor
    })
    .select()
    .single()

  if (error) {
    alert(error.message)
    return
  }

  // 2. Criar participantes
  const lista = participantes.map(nome => ({
    ride_id: ride.id,
    user_id: user.id, // (depois vamos melhorar isso)
    amount: valorPorPessoa,
    paid: nome.trim().toLowerCase() === user.email.toLowerCase()
  }))

  await supabase.from("ride_participants").insert(lista)

  alert("Corrida criada!")
  carregarDividas()
}

// ==========================
// CARREGAR DÍVIDAS
// ==========================
async function carregarDividas() {
  const user = await getUser()

  const { data, error } = await supabase
    .from("ride_participants")
    .select("*")
    .eq("user_id", user.id)

  if (error) {
    console.log(error)
    return
  }

  const lista = document.getElementById("lista")
  if (!lista) return

  lista.innerHTML = ""

  data.forEach(item => {
    const div = document.createElement("div")
    div.className = "item"

    if (item.paid) div.classList.add("pago")

    div.innerHTML = `
      <span>${item.paid ? "Pago" : "Pendente"}</span>
      <strong>R$ ${item.amount}</strong>
    `

    lista.appendChild(div)
  })
}

// ==========================
// PROTEÇÃO DE ROTA
// ==========================
window.onload = async () => {
  const { data } = await supabase.auth.getUser()

  const isLoginPage = window.location.pathname.includes("login")

  if (!data.user && !isLoginPage) {
    window.location.href = "login.html"
  }

  if (data.user && isLoginPage) {
    window.location.href = "index.html"
  }

  if (data.user) {
    carregarDividas()
  }
}