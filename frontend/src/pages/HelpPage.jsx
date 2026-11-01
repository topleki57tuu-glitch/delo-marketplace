import React from 'react';
import { Link } from 'react-router-dom';
import { COMPANY } from '../constants/company.js';
import { LEGAL_DOCS, legalHref } from '../constants/legal.js';
import PageHero, { PageBody } from '../components/PageHero.jsx';
import { IconBox, IconBriefcase, IconJustice, IconLock, IconMail, IconPhone, IconQuestion, IconTools, IconUser } from '../components/icons.jsx';

/**
 * Центр помощи. Ответы сверены с тем, как сервис работает на самом деле
 * (те же правила, что в Пользовательском соглашении): меняется правило
 * в коде — меняется ответ здесь.
 */
const SECTIONS = [
  {
    id: 'customers',
    title: 'Заказчикам',
    icon: IconBriefcase,
    items: [
      {
        q: 'Как разместить задание?',
        a: 'Нажмите «Создать задание» и опишите, что нужно сделать, к какому сроку и за какой бюджет. Укажите город и адрес или отметьте, что работа удалённая. Задание сразу увидят исполнители, а AI-помощник подскажет категорию и структуру описания.',
      },
      {
        q: 'Как выбрать исполнителя?',
        a: 'Сравните отклики: цену, комментарий, рейтинг, отзывы и портфолио. Зелёная отметка «Проверен» значит, что модератор проверил документ исполнителя. Когда вы выбираете исполнителя, сумма задания резервируется на вашем балансе — исполнитель видит, что заказ оплачен.',
      },
      {
        q: 'Можно ли отменить задание?',
        a: 'Пока исполнитель не выбран — в любой момент. После выбора отменить задание в одностороннем порядке нельзя: если что-то пошло не так, откройте спор. Если исполнитель сам откажется от задания, зарезервированные деньги сразу вернутся на ваш баланс.',
      },
      {
        q: 'Как принять работу?',
        a: 'На странице задания нажмите «Подтвердить выполнение и выплатить». Только после этого деньги переходят исполнителю. Если результат вас не устраивает, не подтверждайте — откройте спор.',
      },
    ],
  },
  {
    id: 'specialists',
    title: 'Исполнителям',
    icon: IconTools,
    items: [
      {
        q: 'Как начать получать заказы?',
        a: 'В профиле переключите роль на «Исполнитель» и заполните профиль: описание, навыки, портфолио, город. Заказчики выбирают по профилю и отзывам, поэтому подробный профиль получает больше заказов.',
      },
      {
        q: 'Сколько стоят отклики?',
        a: 'После регистрации доступно 5 бесплатных откликов. Дальше — пакеты: 10 откликов за 190 ₽ или 50 за 790 ₽. С подпиской PRO (от 590 ₽ за 30 дней) отклики не ограничены.',
      },
      {
        q: 'Какая комиссия у сервиса?',
        a: '5% от суммы задания — удерживается при выплате. С действующей подпиской PRO комиссия 0%.',
      },
      {
        q: 'Как вывести деньги?',
        a: 'В профиле нажмите «Вывести» и укажите карту или телефон для СБП. Минимальная сумма — 500 ₽. Заявку проверяет модератор; пока она на проверке, сумма зарезервирована, а если заявку отклонят или вы её отмените — вернётся на баланс.',
      },
      {
        q: 'Зачем проходить верификацию?',
        a: 'Проверенные исполнители получают зелёную отметку в профиле и откликах — заказчики выбирают их охотнее. Подтвердить можно личность по паспорту или статус самозанятого по ИНН.',
      },
    ],
  },
  {
    id: 'goods',
    title: 'Товары',
    icon: IconBox,
    items: [
      {
        q: 'Как купить товар?',
        a: 'Оформите заказ на странице товара — его стоимость зарезервируется на вашем балансе. Продавец подтвердит заказ и отправит товар. Когда получите его, нажмите «Подтвердить получение» в разделе «Мои покупки» — только тогда деньги перейдут продавцу.',
      },
      {
        q: 'Можно ли отменить заказ товара?',
        a: 'Да, пока продавец не отправил товар, — отменить может и покупатель, и продавец. Деньги полностью вернутся на баланс покупателя.',
      },
      {
        q: 'Как продавать?',
        a: 'В разделе «Товары» нажмите «Продать товар», добавьте описание, фото, цену и способ получения. Комиссия с продажи — 5%, с подпиской PRO — 0%.',
      },
    ],
  },
  {
    id: 'money',
    title: 'Деньги и споры',
    icon: IconJustice,
    items: [
      {
        q: 'Как пополнить баланс?',
        a: 'В профиле нажмите «Пополнить» и оплатите через ЮMoney. Деньги зачисляются, когда платёжный сервис подтвердит платёж. Данные карты вводятся на стороне ЮMoney — сервис их не получает.',
      },
      {
        q: 'Где деньги, пока идёт сделка?',
        a: 'На балансе заказчика, в резерве: потратить их нельзя, а исполнитель получит их только после подтверждения работы или по решению арбитра.',
      },
      {
        q: 'Как работает спор?',
        a: 'Спор открывается на странице заказа. Арбитр изучит условия, переписку и файлы в чате и решит, вернуть деньги заказчику или выплатить исполнителю. Поэтому договорённости фиксируйте в чате сервиса.',
      },
      {
        q: 'Можно ли заплатить исполнителю напрямую?',
        a: 'Можно, но тогда сделка не защищена: при оплате мимо сервиса ни резервирование, ни арбитраж не работают, и вернуть деньги через сервис не получится.',
      },
    ],
  },
  {
    id: 'account',
    title: 'Аккаунт и данные',
    icon: IconUser,
    items: [
      {
        q: 'Что видят другие пользователи?',
        a: 'Публичный профиль: имя, город, фото, описание, навыки, портфолио, рейтинг и отзывы. Email и телефон другим пользователям не показываются.',
      },
      {
        q: 'Как сменить пароль?',
        a: 'В профиле, в карточке «Безопасность». Если не помните пароль, нажмите «Забыли пароль?» в окне входа — пришлём ссылку для сброса.',
      },
      {
        q: 'Как удалить аккаунт и данные?',
        a: 'Напишите в поддержку с адреса, указанного в аккаунте. Перед закрытием завершаются или отменяются текущие сделки и выплачивается остаток баланса. Данные удаляются в течение 30 дней, кроме тех, что закон обязывает хранить дольше.',
      },
    ],
  },
];

function Faq({ items }) {
  return (
    <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-700 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60">
      {items.map((f) => (
        <details key={f.q} className="group px-5 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-bold text-slate-900 dark:text-white [&::-webkit-details-marker]:hidden">
            {f.q}
            <span
              className="w-7 h-7 shrink-0 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 transition-transform group-open:rotate-45 text-lg leading-none"
              aria-hidden="true"
            >
              +
            </span>
          </summary>
          <p className="pb-5 -mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

function Contacts() {
  const hasContacts = COMPANY.email || COMPANY.phone;
  return (
    <div className="card p-5 sm:p-6">
      <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Не нашли ответ?</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        Вопрос по конкретной сделке быстрее решить в чате с другой стороной. Не получается
        договориться — откройте спор на странице заказа: его рассмотрит арбитр.
      </p>
      {hasContacts && (
        <ul className="mt-4 space-y-2 text-sm">
          {COMPANY.email && (
            <li>
              <a
                href={`mailto:${COMPANY.email}`}
                className="inline-flex items-center gap-2 font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                <IconMail /> {COMPANY.email}
              </a>
            </li>
          )}
          {COMPANY.phone && (
            <li>
              <a
                href={`tel:${COMPANY.phone.replace(/[^\d+]/g, '')}`}
                className="inline-flex items-center gap-2 font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                <IconPhone /> {COMPANY.phone}
              </a>
            </li>
          )}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <Link to="/disputes" className="btn btn-secondary !py-2">Мои споры</Link>
        <Link to="/profile" className="btn btn-ghost !py-2">Профиль</Link>
      </div>
    </div>
  );
}

export default function HelpPage() {
  return (
    <>
      <PageHero
        eyebrow="Центр помощи"
        icon={IconQuestion}
        title="Как работает ДЕЛО"
        subtitle="Ответы на частые вопросы заказчиков, исполнителей и покупателей: оплата, отмена, споры и данные аккаунта."
      >
        <nav aria-label="Разделы помощи" className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-2 overflow-x-auto no-scrollbar">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="hero-chip">
              <s.icon /> {s.title}
            </a>
          ))}
        </nav>
      </PageHero>

      <PageBody>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
          <div className="space-y-10 min-w-0">
            {SECTIONS.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-24" aria-labelledby={`${s.id}-title`}>
                <h2 id={`${s.id}-title`} className="flex items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-white">
                  <span className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
                    <s.icon />
                  </span>
                  {s.title}
                </h2>
                <Faq items={s.items} />
              </section>
            ))}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24 self-start">
            <Contacts />
            <div className="card p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-lg font-extrabold text-slate-900 dark:text-white">
                <IconLock /> Документы
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                {LEGAL_DOCS.map((d) => (
                  <li key={d.slug}>
                    <Link to={legalHref(d.slug)} className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                      {d.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
