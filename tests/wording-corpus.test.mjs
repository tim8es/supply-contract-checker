import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/engine.mjs';

/** 24 independently specified wording/negative scenarios, not runtime fixtures. */
const cases = [
  {
    "name": "Scenario 1: variant",
    "price": "Общая стоимость поставки составляет 245 600 рублей.",
    "date": "Срок поставки: 12.04.2026.",
    "amount": 245600,
    "deadline": "2026-04-12"
  },
  {
    "name": "Scenario 2: variant",
    "price": "Цена договора — 987 000 рублей.",
    "date": "Поставщик обязуется поставить товар не позднее 19.05.2026.",
    "amount": 987000,
    "deadline": "2026-05-19"
  },
  {
    "name": "Scenario 3: variant",
    "price": "Общая сумма контракта составляет 1 500 000 рублей.",
    "date": "Поставка осуществляется до 05.06.2026.",
    "amount": 1500000,
    "deadline": "2026-06-05"
  },
  {
    "name": "Scenario 4: variant",
    "price": "Итоговая стоимость поставки установлена в размере 2 050 000 рублей.",
    "date": "Срок отгрузки — 13.04.2026.",
    "amount": 2050000,
    "deadline": "2026-04-13"
  },
  {
    "name": "Scenario 5: variant",
    "price": "Стоимость оборудования по договору составляет 444 000 рублей.",
    "date": "Отгрузить товар не позднее 24.04.2026.",
    "amount": 444000,
    "deadline": "2026-04-24"
  },
  {
    "name": "Scenario 6: variant",
    "price": "Договорная цена: 135 790 рублей.",
    "date": "Поставщик обязуется поставить оборудование не позднее 20.03.2026.",
    "amount": 135790,
    "deadline": "2026-03-20"
  },
  {
    "name": "Scenario 7: variant",
    "price": "Сумма поставки составляет 450 000 рублей.",
    "date": "Срок поставки: 10 апреля 2026 года.",
    "amount": 450000,
    "deadline": "2026-04-10"
  },
  {
    "name": "Scenario 8: variant",
    "price": "Цена контракта определена в размере 700 500 рублей.",
    "date": "Срок поставки: 09.04.2026.",
    "amount": 700500,
    "deadline": "2026-04-09"
  },
  {
    "name": "Scenario 9: variant",
    "price": "Итого по договору: 1 950 000 рублей.",
    "date": "Срок поставки: 02.05.2026.",
    "amount": 1950000,
    "deadline": "2026-05-02"
  },
  {
    "name": "Scenario 10: variant",
    "price": "Общая стоимость договора составляет 555 000 рублей.",
    "date": "Срок поставки: 04.05.2026.",
    "amount": 555000,
    "deadline": "2026-05-04"
  },
  {
    "name": "Scenario 11: variant",
    "price": "Цена договора равна 800 000 рублей.",
    "date": "Срок поставки: 06.05.2026.",
    "amount": 800000,
    "deadline": "2026-05-06"
  },
  {
    "name": "Scenario 12: variant",
    "price": "Итоговая сумма договора равна 200 000 рублей.",
    "date": "Срок поставки: 08.05.2026.",
    "amount": 200000,
    "deadline": "2026-05-08"
  },
  {
    "name": "Scenario 13: negative",
    "price": "Внутренний бюджет по закупке установлен в размере 680 000 рублей.",
    "date": "Срок поставки: 12.04.2026.",
    "amount": null,
    "deadline": "2026-04-12"
  },
  {
    "name": "Scenario 14: negative",
    "price": "Аванс составляет 250 000 рублей. Стоимость определяется спецификацией.",
    "date": "Срок поставки: 13.04.2026.",
    "amount": null,
    "deadline": "2026-04-13"
  },
  {
    "name": "Scenario 15: negative",
    "price": "Покупатель оплатит аванс до 12.05.2026.",
    "date": "",
    "amount": null,
    "deadline": null
  },
  {
    "name": "Scenario 16: negative",
    "price": "Дата приёмки товара — 17.04.2026.",
    "date": "",
    "amount": null,
    "deadline": null
  },
  {
    "name": "Scenario 17: negative",
    "price": "Цена договора согласовывается отдельно.",
    "date": "Срок поставки 15 рабочих дней после оплаты.",
    "amount": null,
    "deadline": null
  },
  {
    "name": "Scenario 18: negative",
    "price": "Стоимость договора не указана.",
    "date": "",
    "amount": null,
    "deadline": null
  },
  {
    "name": "Scenario 19: negative",
    "price": "Цена договора составляет 5 000 000 долларов США.",
    "date": "",
    "amount": null,
    "deadline": null
  },
  {
    "name": "Scenario 20: negative",
    "price": "Цена договора составляет 100 000 рублей.",
    "date": "Срок поставки: 31.02.2026.",
    "amount": 100000,
    "deadline": null
  },
  {
    "name": "Scenario 21: negative",
    "price": "Цена договора составляет 100 000 рублей.",
    "date": "Срок поставки: 05.13.2026.",
    "amount": 100000,
    "deadline": null
  },
  {
    "name": "Scenario 22: negative",
    "price": "Цена договора составляет 500 тысяч рублей.",
    "date": "",
    "amount": null,
    "deadline": null
  },
  {
    "name": "Scenario 23: negative",
    "price": "Общая стоимость поставки составляет 80 000 рублей, включая НДС 16 000 рублей.",
    "date": "Срок поставки: 15.04.2026.",
    "amount": 80000,
    "deadline": "2026-04-15"
  },
  {
    "name": "Scenario 24: negative",
    "price": "Цена договора: 100 000 рублей.\nЦена договора: 200 000 рублей.",
    "date": "",
    "amount": null,
    "deadline": null
  }
];

function build({price,date},index) {
 const id='COR-'+String(200+index);
 return {name:'renamed-'+String(index)+'.txt',text:'ДОГОВОР ПОСТАВКИ № '+id+'\\nСтатус: подписан обеими сторонами 01.02.2026.\\n\\nПоставщик: ООО «Эксперимент».\\n\\n'+price+'\n'+date};
}
for (const [index,scenario] of cases.entries()) {
 test('independent corpus ' + scenario.name,()=>{
  const source=build(scenario,index);
  const {rows}=analyze([source],'2026-03-10');
  assert.equal(rows.length,1);
  assert.equal(rows[0].amount?.value??null,scenario.amount);
  assert.equal(rows[0].deadline?.value??null,scenario.deadline);
  for (const field of ['amount','deadline']) {
    const evidence=rows[0][field]?.evidence;
    if (!evidence) continue;
    assert.equal(evidence.file,source.name);
    const original=source.text.split('\n').slice(evidence.line-1,evidence.endLine).join('\n');
    assert.equal(evidence.quote,original);
  }
 });
}
