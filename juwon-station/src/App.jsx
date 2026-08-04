import ChargeDashboard from "./ChargeDashboard";

export default function App() {
  return (
    <ChargeDashboard
      onGoMain={() => console.log("→ 1(초기화면)")}
      onGoPayment={() => console.log("→ 6-1(결제-선택)")}
    />
  );
}
