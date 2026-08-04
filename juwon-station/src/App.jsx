import ChargeDashboard from './ChargeDashboard';

export default function App() {
	return <ChargeDashboard onGoDetail={() => console.log('→ 상세 보기')} onGoMain={() => console.log('→ 1(초기화면)')} />;
}
