import { Button } from "./components/ui/button"

export default function App() {
  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: "100vh",
      flexDirection: "column",
      gap: "20px"
    }}>
      <h1 style={{ fontSize: "28px", fontWeight: "bold" }}>
        POSLY POS System
      </h1>

      <Button>Default Button</Button>
      <Button variant="destructive">Delete Button</Button>
      <Button variant="outline">Outline Button</Button>
    </div>
  )
}