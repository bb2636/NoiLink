/**
 * 추천 롤모델 카드 — 개인 리포트와 기업 리포트에서 동일한 UI로 사용.
 */

export interface RoleModelCardProps {
  subtitle: string; // "{이름}님의 롤모델"
  name: string; // 롤모델 이름 (큰 타이틀)
  quote: string; // 라임 컬러 한 줄 인용구 (oneLiner)
  traits?: string[]; // 핵심특성 태그
  connectionHeadline?: string; // 뇌지컬 연결성 — 굵은 한 줄
  connectionDetail?: string; // 뇌지컬 연결성 — 보조 설명
}

export default function RoleModelCard({
  subtitle,
  name,
  quote,
  traits = ['꾸준함', '장기 사고', '원칙 고수'],
  connectionHeadline,
  connectionDetail,
}: RoleModelCardProps) {
  return (
    <section
      className="rounded-2xl p-6 border"
      style={{ backgroundColor: '#1A1A1A', borderColor: '#2A2A2A' }}
    >
      <div className="text-center">
        <p className="text-xs" style={{ color: '#888' }}>
          {subtitle}
        </p>
        <h4 className="text-3xl font-extrabold text-white mt-2">{name}</h4>
        <p className="text-sm mt-4" style={{ color: '#AAED10' }}>
          “{quote}”
        </p>
      </div>

      <div className="my-5 h-px" style={{ backgroundColor: '#2A2A2A' }} />

      <div className="space-y-5">
        <div>
          <p className="text-[13px] mb-2.5">
            <span className="font-semibold mr-2" style={{ color: '#AAED10' }}>
              01
            </span>
            <span className="text-white font-medium">핵심특성</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {traits.map((t) => (
              <span
                key={t}
                className="px-3.5 py-1.5 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: '#1F2A0E',
                  color: '#AAED10',
                  border: '1px solid #3A5C1A',
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[13px] mb-2.5">
            <span className="font-semibold mr-2" style={{ color: '#AAED10' }}>
              02
            </span>
            <span className="text-white font-medium">뇌지컬 연결성</span>
          </p>
          {connectionHeadline && (
            <p className="text-sm font-semibold text-white leading-relaxed">
              {connectionHeadline}
            </p>
          )}
          {connectionDetail && (
            <p className="text-xs mt-2 leading-relaxed" style={{ color: '#888' }}>
              {connectionDetail}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
