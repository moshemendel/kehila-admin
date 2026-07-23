interface Props {
  title?: string;
  reopenAt?: string;
  onDevBypass?: () => void;
}

export default function ShabbatLockScreen({ title, reopenAt, onDevBypass }: Props) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1B3A6B] to-[#0f2347] flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
        <div className="text-3xl font-black text-[#1B3A6B] mb-1">קהילה</div>
        <div className="text-slate-400 text-sm mb-6">ממשק ניהול</div>

        <div className="text-4xl mb-4">🕯️</div>
        <div className="text-xl font-bold text-slate-800">{title ?? 'שבת שלום'}</div>

        <div className="w-12 h-0.5 bg-slate-200 mx-auto my-5" />

        <div className="text-slate-700 font-medium">המערכת סגורה בשבת ובחג</div>
        <div className="text-slate-400 text-sm mt-1">מתוך כבוד לקדושת היום 🤍</div>

        {reopenAt && (
          <div className="mt-6 bg-slate-50 rounded-xl px-4 py-3">
            <div className="text-xs text-slate-500">המערכת תיפתח מחדש בצאת השבת/החג</div>
            <div className="text-2xl font-black text-[#1B3A6B] mt-1">{reopenAt}</div>
          </div>
        )}

        {onDevBypass && (
          <button
            onClick={onDevBypass}
            className="mt-6 text-xs text-slate-300 hover:text-slate-400 border border-slate-200 rounded-full px-3 py-1"
          >
            (dev) המשך בכל זאת
          </button>
        )}
      </div>
    </div>
  );
}
