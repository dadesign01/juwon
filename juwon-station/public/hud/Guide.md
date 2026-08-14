방향 화살표 아이콘 적용

방향 화살표 아이콘은 정상·주의·경고 상태별 북쪽(N) 기준 아이콘​으로 구성되어 있습니다.

북쪽(N) 기준 아이콘을 바탕으로 CSS 및 JS의 회전값을 활용하여 북동·동·남동·남·남서·서·북서 등 나머지 7개 방향을 제어하여 적용해 주세요.

방향 전환 시 회전 과정이 애니메이션으로 노출되는 방식이 아닌, 각 방향으로 회전된 상태를 기준으로 위치 이동 등의 애니메이션이 적용되도록 구현해 주세요.

코드 구현 방식은
전달 파일 내 scene2.html 를 참고해 주세요.



```

- 방향 전환 참고
	좌측 마크 direction 아이콘 2가지 45도 방향 css 
	#a4 {
		width: 120px;
		left: 225px;
		top: 422px;
		--x: 0px;
		--y: 0px;
		transform: rotate(45deg) translate(var(--x), var(--y));
		/*45도 각도 */
	}

- 방향 화살표 이동 참고
코드1 
	// direction 아이콘 이동 시작 위치
	a4.style.transition = 'none';
	a4.style.setProperty('--x', '0px');
	a4.style.setProperty('--y', '113px');

코드2
	requestAnimationFrame(function () {
		a4.style.transition =
			'transform 0.8s ease-out';
		a4.style.setProperty('--x', '0px');
		a4.style.setProperty('--y', '0px');
	});


코드3
	// 다시 북동쪽 시작 위치
	a4.style.transition = 'none';
	a4.style.setProperty('--x', '0px');
	a4.style.setProperty('--y', '113px');
	a4.offsetHeight;

코드4
	// 다시 최종 위치로 이동
	requestAnimationFrame(function () {
		a4.style.transition =
			'transform 0.8s ease-out';
		a4.style.setProperty('--x', '0px');
		a4.style.setProperty('--y', '0px');
	});


```
