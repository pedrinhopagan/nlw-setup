import { FastifyInstance } from 'fastify'
import { prisma } from "./lib/prisma"
import { z } from 'zod'
import dayjs from 'dayjs'

export async function appRoutes(app: FastifyInstance){

  // Adicionat novos hábitos para teste
  app.post(('/habits'), async (request) => {
      // Quer receber do meu banco de dados: title, weekDays
    const createHabitBody = z.object({
      title: z.string(),
      weekDays: z.array(z.number().min(0).max(6))
    })

    // Acessar os dias da semana por um array [0, 1, 2] => Domingo, segunda e terça
    const { title, weekDays } = createHabitBody.parse(request.body)

    const today = dayjs().startOf('day').toDate()

    await prisma.habit.create({
      data: {
        title,
        created_at: today,
        weekDays: {
          create: weekDays.map(weekDay =>{
            return {
              week_day: weekDay,
            }
          })
        }
      }
    })
  })

  // Receber os dados de todos os possíveis hábitos e quais foram completados de UM UNICO DIA
  app.get(('/day'), async (request) => {
    const getDayParams = z.object({
      date: z.coerce.date()
    })

    const { date } = getDayParams.parse(request.query)

    const parsedDate = dayjs(date).startOf('day')
    const weekDay = parsedDate.get('day')

    // todos hábitos possiveis
    // hábitos que ja foram completados

    const possibleHabits = await prisma.habit.findMany({
      where: {
        created_at: {
          lte: date,
        },
        weekDays: {
          some: {
            week_day: weekDay
          }
        }
      }
    })

    const day = await prisma.day.findUnique({
      where: {
        date: parsedDate.toDate(),
      },
      include: {
        dayHabits: true,
      }
    })

    const completedHabits = day?.dayHabits.map(dayHabit => {
      return dayHabit.habit_id
    }) ?? []

    return {
      possibleHabits,
      completedHabits
    }
  })

  // Completar / não-completar um hábito
  app.patch('/habits/:id/toggle', async (request) =>{
    //route param => ↑ parametro de identifcação

    const toggleHabitParams = z.object({
      id: z.string().uuid()
    })

    const { id } = toggleHabitParams.parse(request.params)

    const today = dayjs().startOf('day').toDate()
    
    // Checando se o dia existe
    let day = await prisma.day.findUnique({
      where: {
        date: today
      }
    })
    // Criando o dia no banco de dados caso ele nao exista
    if (!day) {
      day = await prisma.day.create({
        data: {
          date: today
        }
      })
    }

    const dayHabit = await prisma.dayHabit.findUnique({
      where: {
        day_id_habit_id: {
          day_id: day.id,
          habit_id: id,
        }
      }
    })

    //Se o hábito já foi concluido
    if(dayHabit) {
      // remove a marcação de completo
      await prisma.dayHabit.delete({
        where: {
          id: dayHabit.id,
        }
      })
    } else {
      // Completar o hábito nesse dia
      await prisma.dayHabit.create({
        data: {
          day_id: day.id,
          habit_id: id,
        }
      })
    }

  })

  // Trazer um resumo do banco de dados pra fazer o display dos dias completos
  app.get('/summary', async () => {
    // [ { date: 20/01, amount: 5, completed: 3 }, { date: 21/01, amount: 2, completed: 2 }]
    // Prisma ORM: RAW SQL => SQLite 

    const summary = await prisma.$queryRaw`
      SELECT 
        D.id,
        D.date,
        (
          SELECT 
            cast(count(*) as float)
          FROM
            day_habits DH
          WHERE
            DH.day_id = D.id
        ) as completed,
        (
          SELECT
            cast(count(*) as float)
          FROM 
            habit_week_days HWD
          JOIN habits H
            ON H.id = HWD.habit_id
          WHERE
            HWD.week_day = cast(strftime('%w', D.date/1000.0, 'unixepoch') as int)
            AND H.created_at <= D.date
        ) as amount        
      FROM days D    
    `
    // Sub Queries

    // SQLite salva em Epoch & Unix Timestamp 
    return summary
  })
}
