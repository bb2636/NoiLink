import { useRef, useEffect, useState } from 'react';

interface LineChartProps {
  data: Array<{ date: string; value: number }>;
  label: string;
  color?: string;
  height?: number;
  showToggle?: boolean;
  onToggle?: (visible: boolean) => void;
}

export default function LineChart({
  data,
  label,
  color = '#0ea5e9',
  height = 200,
  showToggle = false,
  onToggle,
}: LineChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (data.length === 0) return;

    // Find min/max values
    const values = data.map((d) => d.value);
    const minValue = Math.min(...values, 0);
    const maxValue = Math.max(...values, 100);
    const range = maxValue - minValue || 1;

    // Draw grid
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (chartHeight * i) / 5;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Draw line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    data.forEach((point, index) => {
      const x = padding + (chartWidth * index) / (data.length - 1 || 1);
      const y =
        padding +
        chartHeight -
        (chartHeight * (point.value - minValue)) / range;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // Draw points
    ctx.fillStyle = color;
    data.forEach((point, index) => {
      const x = padding + (chartWidth * index) / (data.length - 1 || 1);
      const y =
        padding +
        chartHeight -
        (chartHeight * (point.value - minValue)) / range;

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    data.forEach((point, index) => {
      if (index % Math.ceil(data.length / 5) === 0 || index === data.length - 1) {
        const x = padding + (chartWidth * index) / (data.length - 1 || 1);
        const date = new Date(point.date);
        const label = `${date.getMonth() + 1}/${date.getDate()}`;
        ctx.fillText(label, x, height - padding + 5);
      }
    });

    // Draw Y-axis labels
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
      const y = padding + (chartHeight * i) / 5;
      const value = Math.round(maxValue - (range * i) / 5);
      ctx.fillText(String(value), padding - 5, y);
    }
  }, [data, color, height, visible]);

  const handleToggle = () => {
    const newVisible = !visible;
    setVisible(newVisible);
    if (onToggle) {
      onToggle(newVisible);
    }
  };

  return (
    <div className="space-y-2">
      {showToggle && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">{label}</span>
          <button
            onClick={handleToggle}
            className={`px-2 py-1 text-xs rounded ${
              visible
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {visible ? '숨기기' : '보기'}
          </button>
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={400}
        height={height}
        className="w-full"
        style={{ display: visible ? 'block' : 'none' }}
      />
    </div>
  );
}
